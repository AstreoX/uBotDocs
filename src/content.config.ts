import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // The uBot packages a page is about: ["UBotSensor"], optionally with a version range
        // ("UBotSensor@^0.1"). A folder's _group.yml may set a default (lib/content-packages.mjs);
        // `npm run check` checks the names against data/index.json.
        packages: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(@.+)?$/)).optional(),
      }),
    }),
  }),
};
