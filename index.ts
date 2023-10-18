import "dotenv/config";
import { gql, GraphQLClient } from "graphql-request";
import { v4 as uuidv4 } from "uuid";
import { Readable, Writable } from "stream";
import { finished } from "stream/promises";
import { createObjectCsvWriter } from "csv-writer"
import { backOff } from "exponential-backoff";

const listArticles = gql`
  query GetSavedItems(
    $filter: SavedItemsFilter
    $sort: SavedItemsSort
    $pagination: PaginationInput
  ) {
    user {
      savedItems(filter: $filter, sort: $sort, pagination: $pagination) {
        edges {
          cursor
          node {
            url
            _createdAt
            _updatedAt
            id
            status
            isFavorite
            favoritedAt
            isArchived
            archivedAt
            tags {
              id
              name
            }
            item {
              ...ItemDetails
              ... on Item {
                article
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        totalCount
      }
    }
  }
  fragment ItemDetails on Item {
    title
    givenUrl
    datePublished
  }
`;

const savePageMutation = gql`
  mutation savePage($input: SavePageInput!) {
    savePage(input: $input) {
      ... on SaveSuccess {
        url
        clientRequestId
      }
      ... on SaveError {
        errorCodes
        message
      }
    }
  }
`;

const POCKET_GRAPHQL_URL = `https://getpocket.com/graphql?consumer_key=${process.env.POCKET_CONSUMER_KEY}&enable_cors=1`;
const OMNIVORE_API_URL = "https://api-prod.omnivore.app/api/graphql";

async function main() {
  const pocketClient = new GraphQLClient(POCKET_GRAPHQL_URL, {
    headers: {
      "Content-Type": "application/json",
      "Cookie": process.env.POCKET_COOKIE,
    }
  });

  const omniClient = new GraphQLClient(OMNIVORE_API_URL, {
    headers: {
      authorization: process.env.OMNIVORE_API_KEY,
      "content-type": "application/json"
    },
  });

  let pageInfo: {
    hasNextPage: boolean,
    hasPreviousPage: boolean,
    startCursor: string,
    endCursor: string
  };
  let currentPage: object[];

  type ListArticlesResponse = {
    user: {
      savedItems: {
        pageInfo: {
          hasNextPage: boolean,
          hasPreviousPage: boolean,
          startCursor: string,
          endCursor: string
        },
        edges: object[],
        totalCount: number
      }
    }
  };

  /**
   * Sorta dumb function that holds each request for a minimum of 5 seconds,
   * used to artificially slow down requests to the Pocket API
   */
  const rateLimit: <T>(promise: Promise<T>) => Promise<T> = (promise) => {
    return Promise.all([
      promise,
      new Promise(resolve => { setTimeout(resolve, 5000); })
    ]).then(resolved => resolved[0])
  }

  /**
   * Makes a request to the Pocket API for the next page of results.
   * Rate limited to not trip their blocks, and uses exponential backoff
   * to retry requests in the case of failures.
   */
  const getNextPage: () => Promise<ListArticlesResponse> = () => {
    return rateLimit(backOff(() => pocketClient.request(listArticles, {
      filter: {
        statuses: ["UNREAD", "ARCHIVED"],
      },
      sort: {
        sortBy: "CREATED_AT",
        sortOrder: "DESC"
      },
      pagination: pageInfo ? {
        after: pageInfo.endCursor
      } : null
    })));
  };

  const readArticles = new Readable({
    objectMode: true,
    highWaterMark: 90,
    async read(_size) {
      if (!pageInfo || pageInfo.hasNextPage && currentPage.length === 0) {
        ({ user: { savedItems: { pageInfo, edges: currentPage }}} = await getNextPage());
      }

      if (currentPage.length > 0) {
        this.push(currentPage.shift());
      } else {
        this.push(null);
      }
    }
  });

  const failedEntries: object[] = [];

  type PocketTag = { id: string, name: string }
  const labelsForArticle = (tags: PocketTag[], isFavorite: boolean) => {
    const labels = tags.map(({ name }) => ({ name }));
    if (isFavorite && process.env.FAVORITE_LABEL) {
      labels.push({name: process.env.FAVORITE_LABEL});
    }
    if (process.env.GLOBAL_IMPORT_LABEL) {
      labels.push({name: process.env.GLOBAL_IMPORT_LABEL});
    }
    return labels;
  };

  const writeToOmnivore = new Writable({
    objectMode: true,
    async write(article, _encoding, callback) {
      const { node: { tags, _createdAt, isArchived, isFavorite, item } } = article;
      const labels = labelsForArticle(tags, isFavorite);

      console.log(`Saving "${item.title}" (${item.givenUrl})`);

      await omniClient.request(savePageMutation, {
        input: {
          url: item.givenUrl,
          clientRequestId: uuidv4(),
          title: item.title,
          originalContent: item.article,
          savedAt: new Date(_createdAt * 1000),
          publishedAt: new Date(item.datePublished),
          // The server barfs if sent an empty array, so work around that
          labels: labels.length > 0 ? labels : null,
          source: "api",
          state: isArchived ? "ARCHIVED" : "SUCCEEDED"
        },
      }).catch((error) => {
        console.log("Failed!", error);
        failedEntries.push({
          url: item.givenUrl,
          title: item.title,
          tags: tags.join(","),
          timestamp: _createdAt
        });
      });

      callback(null);
    }
  });

  const handleErrors = () => {
    if (failedEntries.length === 0) {
      return;
    }

    const csvWriter = createObjectCsvWriter({
      path: `error_${new Date().toJSON().slice(0, 10)}.csv`,
      header: [
        { id: 'url', title: 'URL' },
        { id: 'title', title: 'Title' },
        { id: 'tags', title: 'Tags' },
        { id: 'timestamp', title: 'Timestamp' },
      ]
    });

    csvWriter
      .writeRecords(failedEntries)
      .then(() => console.log('Errors written to CSV file.'));
  };

  readArticles.pipe(writeToOmnivore);
  await finished(writeToOmnivore);

  console.log("Import finished.");
  handleErrors();
}

main();
