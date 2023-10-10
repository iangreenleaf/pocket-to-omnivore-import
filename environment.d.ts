declare global {
  namespace NodeJS {
    interface ProcessEnv {
      POCKET_COOKIE: string;
      POCKET_CONSUMER_KEY: string;
      OMNIVORE_API_KEY: string;
    }
  }
}

export {};
