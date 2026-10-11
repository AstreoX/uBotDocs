import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { PAGE_KINDS } from "../lib/content-packages.mjs";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // The uBot packages a page is about: ["UBotSensor"], optionally with a version range
        // ("UBotSensor@^0.1"). A folder's _group.yml may set a default (lib/content-packages.mjs);
        // `npm run check` checks the names against data/index.json.
        packages: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(@.+)?$/)).optional(),
        // The kind of page, which decides its structure and what `npm run check` requires of it:
        // overview | feature | concept | settings | faq | placeholder (docs-templates/, CLAUDE.md).
        pageKind: z.string().refine((kind) => PAGE_KINDS.includes(kind), { message: `pageKind must be one of ${PAGE_KINDS.join(", ")}` }).optional(),
        // false: a feature page that is not about Blueprint nodes (installation, command line, C++),
        // so `npm run check` does not ask for a graph.
        graph: z.boolean().optional(),
      }),
    }),
  }),
};
