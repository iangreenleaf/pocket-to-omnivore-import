# Pocket permanent library => Omnivore

A little script that I made to import my huge collection of links from [Pocket](https://getpocket.com/) to [Omnivore](https://omnivore.app/home).
While Omnivore has Pocket import built in, I wanted to keep the full contents of articles from my Pocket permanent library.

## Configuration

The script uses environment variables for configuration settings.
The easiest way to set these is to write them to a `.env` file, which will be
automatically imported.

To start with the provided template:

    $ cp .env.example .env

Now edit the `.env` file to add your variables.
Options are as follows:

 * `GLOBAL_IMPORT_LABEL` (optional): A label that will be applied to every article
   imported by this script.
 * `FAVORITE_LABEL` (optional): A label to be applied to all articles that were
   favorited in Pocket.
 * `OMNIVORE_API_KEY` (required): [Create an API key in Omnivore](https://omnivore.app/settings/api)
   and copy the value to here.
 * `POCKET_CONSUMER_KEY` and `POCKET_COOKIE` (required): These are a little trickier to get.
   1. Open the dev tools in your browser, navigate to the Network tab, and visit your Pocket
      home page.
   2. You'll want to find an XHR GraphQL request. The URL will look something like this:
      ```
      https://getpocket.com/graphql?consumer_key=XXXX-XXXXXXX&enable_cors=1
      ```
   3. Copy the value of `POCKET_CONSUMER_KEY` out of the URL.
   4. Inspect the request headers and find the `Cookie` header. Copy the entire value
      as a string and use that for `POCKET_COOKIE`. The end result will be very long and
      should look something like this:
      ```
      POCKET_COOKIE='G_ENABLED_IDPS=google; _omappvp=AbCd1234...'
      ```

## Usage

You'll need to have a NodeJS runtime installed.
Clone this repository and run:

    $ npm install

Now you can begin the import by running:

    $ npm run import

It should print progress info to the screen as it runs.
The script may take a long time to complete, especially if you have a large library.
It's safe-ish to run multiple times if it doesn't finish, but it will start over at
the beginning each time so try not to interrupt it.
