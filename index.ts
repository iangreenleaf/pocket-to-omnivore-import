import * as htmlparser2 from "htmlparser2";
import { WritableStream } from "htmlparser2/lib/WritableStream";
import { createObjectCsvWriter } from "csv-writer"
import "dotenv/config";
import fs from "fs";
import { gql, GraphQLClient } from "graphql-request";
import { finished } from "stream/promises";
import { v4 as uuidv4 } from 'uuid';

interface ImportItem {
  url: string,
  title: string,
  tags: [string],
  timestamp: string
}

const OMNIVORE_API_URL = "https://api-prod.omnivore.app/api/graphql";
const POCKET_HTML_EXPORT_PATH = `${__dirname}/pocket_export_test.html`;
const csvWriter = createObjectCsvWriter({
  path: `error_${new Date().toJSON().slice(0, 10)}.csv`,
  header: [
    { id: 'url', title: 'URL' },
    { id: 'title', title: 'Title' },
    { id: 'selection', title: 'Selection' },
    { id: 'folder', title: 'Folder' },
    { id: 'timestamp', title: 'Timestamp' },
  ]
});

// https://github.com/omnivore-app/omnivore/blob/main/packages/api/src/schema.ts
const createArticleMutation = gql`
  mutation CreateArticleSavingRequest($input: CreateArticleSavingRequestInput!) {
    createArticleSavingRequest(input: $input) {
      ... on CreateArticleSavingRequestSuccess {
        articleSavingRequest {
          id
          status
        }
      }
      ... on CreateArticleSavingRequestError {
        errorCodes
      }
    }
  }
`;

const saveUrlMutation = gql`
  mutation saveUrl($input: SaveUrlInput!) {
    saveUrl(input: $input) {
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

const createArchiveMutation = gql`
  mutation SetLinkArchived($input: ArchiveLinkInput!) {
    setLinkArchived(input: $input) {
      ... on ArchiveLinkSuccess {
        linkId
        message
      }
      ... on ArchiveLinkError {
          message
        errorCodes
      }
    }
  }
`;

let inH1 = false;
let inUl = false;
let inLi = false;
let inUnread = false;
let inArchive = false;
let currentText = "";
let currentImport = null;

const parserStream = new WritableStream({
  onopentagname(tagname) {
    currentText = "";

    if (tagname === "h1") {
      inH1 = true;
    } else if (tagname === "ul") {
      inUl = true;
    } else if (tagname === "li" && inUl) {
      inLi = true;
    }
  },
  onopentag(tagname, attributes) {
    if (tagname === "a" && inLi) {
      currentImport = {
        url: attributes.href,
        title: null,
        tags: labelsFromTags(attributes.tags),
        timestamp: attributes.time_added
      }
    }
  },
  ontext(text) {
    currentText = currentText.concat(text);
  },
  onclosetag(tagname) {
    if (tagname === "h1") {
      if (inH1) {
        inH1 = false;
        if (currentText == "Unread") {
          inUnread = true;
        } else if (currentText === "Read Archive") {
          inArchive = true;
        } else {
          console.error(`Encountered unknown list: ${currentText}`);
        }
      }
    } else if (tagname === "ul") {
      inUl = false;
      inUnread = false;
      inArchive = false;
    } else if (tagname === "li" && inUl) {
      inLi = false;
    } else if (tagname === "a" && inLi) {
      currentImport.title = currentText;
      addArticle(currentImport);
    }

    currentText = "";
  },
});

function labelsFromTags(tags) {
  let labels = (tags === "") ? [] : tags.split(",");
  if (process.env.GLOBAL_IMPORT_LABELS !== "") {
    labels = labels.concat(process.env.GLOBAL_IMPORT_LABELS.split(","));
  }
  return labels;
}

async function addArticle(entry: ImportItem) {
  if (!inArchive) {
    return
  }
  const client = new GraphQLClient(OMNIVORE_API_URL, {
    headers: {
      authorization: process.env.OMNIVORE_API_KEY,
      "content-type": "application/json"
    },
  });
  /*
  const response = await client.request(saveUrlMutation, {
    "input": {
      "clientRequestId": "85282635-4DF4-4BFC-A3D4-B3A004E57067",
      "source": "api",
      "url": entry.url
    }
  });
  const response = await client.request(createArticleMutation, {
    input: {
      url: entry.url
    }
  });
 */
  const response = await client.request(saveUrlMutation, {
    input: {
      url: entry.url,
      clientRequestId: uuidv4(),
      labels: entry.tags.map(tag => ({name: tag})),
      source: 'api'
    },
  });
  console.log("-->", entry);
  console.log(response);
}

async function processHtml() {
  const records: ImportItem[] = [];
  const parser = fs.createReadStream(POCKET_HTML_EXPORT_PATH).pipe(parserStream);

  await finished(parser);
  return records;
}

async function main() {
  if (!process.env.OMNIVORE_AUTH_COOKIE) {
    throw new Error(
      "No auth token found. Did you forget to add it to the .env file?"
    );
  }

  const client = new GraphQLClient(OMNIVORE_API_URL, {
    headers: {
      Cookie: `auth=${process.env.OMNIVORE_AUTH_COOKIE};`,
    },
  });

  const entries = await processHtml();
  let addedEntriesCount = 0;
  let archivedEntriesCount = 0;
  let failedEntriesCount = 0;

  const failedEntries: ImportItem[] = [];

  console.log(`Adding ${entries.length} links to Omnivore..`);
  return;

  for (const entry of entries) {
    try {
      const response = await client.request(createArticleMutation, {
        input: { url: entry.url },
      });
      addedEntriesCount++;

      var result = response;
      if (entry.folder == "Archive") {
        await client.request(createArchiveMutation, {
          input: { linkId: result.createArticleSavingRequest.articleSavingRequest.id, archived: true },
        });
        archivedEntriesCount++;
      }

    } catch (error) {
      console.error(`🚫 Failed to add ${entry.url}`);
      failedEntries.push({
        url: entry.url,
        title: entry.title,
        selection: entry.selection,
        folder: entry.folder,
        timestamp: entry.timestamp
      })

      failedEntriesCount++;
    }
  }

  console.log(
    `Successfully added ${addedEntriesCount} (Archived: ${archivedEntriesCount}) of ${entries.length} links!`
  );

  if (failedEntriesCount > 0) {
    csvWriter
      .writeRecords(failedEntries)
      .then(() => console.log('The CSV file was written successfully'));
  }
}

main();
