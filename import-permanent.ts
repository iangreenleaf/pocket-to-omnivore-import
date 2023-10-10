import "dotenv/config";
import { gql, GraphQLClient } from "graphql-request";
import { v4 as uuidv4 } from 'uuid';

const getArticleById = gql`
  query GetSavedItemById($itemId: ID!) {
    user {
      savedItemById(id: $itemId) {
        ...SavedItemDetails
        annotations {
          highlights {
            id
            quote
            patch
            version
            _createdAt
            _updatedAt
            note {
              text
              _createdAt
              _updatedAt
            }
          }
        }
        item {
          ...ItemDetails
          ... on Item {
            article
          }
        }
      }
    }
  }
  fragment SavedItemDetails on SavedItem {
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
  }
  fragment ItemDetails on Item {
    isArticle
    title
    itemId
    resolvedId
    resolvedUrl
    domain
    domainMetadata {
      name
    }
    excerpt
    hasImage
    hasVideo
    images {
      caption
      credit
      height
      imageId
      src
      width
    }
    videos {
      vid
      videoId
      type
      src
    }
    topImageUrl
    timeToRead
    givenUrl
    collection {
      imageUrl
      intro
      title
      excerpt
    }
    authors {
      id
      name
      url
    }
    datePublished
    syndicatedArticle {
      slug
      publisher {
        name
        url
      }
    }
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

  const response = await pocketClient.request(getArticleById, {
    itemId: process.env.POCKET_ARTICLE_ID,
  });

  const savedItem = response.user.savedItemById.item;

  const labels = response.user.savedItemById.tags.map((tag:string) => ({name: tag}));

  const savePageResponse = await omniClient.request(savePageMutation, {
    input: {
      url: savedItem.givenUrl,
      clientRequestId: uuidv4(),
      title: savedItem.title,
      originalContent: savedItem.article,
      savedAt: new Date(response.user.savedItemById.archivedAt * 1000),
      publishedAt: new Date(savedItem.datePublished),
      // The server barfs if sent an empty array, so work around that
      labels: labels.length > 0 ? labels : null,
      source: 'api',
    },
  });

  console.log(savePageResponse);
}

main();
