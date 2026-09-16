import { z } from "zod";

const moneySchema = z
  .object({
    value: z.union([z.number(), z.string(), z.null()]).optional(),
    currency: z.string().nullable().optional(),
  })
  .passthrough();

export const sourceProductSchema = z
  .object({
    id: z.union([z.string(), z.number()]).nullable().optional(),
    uid: z.string().nullable().optional(),
    sku: z.union([z.string(), z.number()]).nullable().optional(),
    name: z.string().nullable().optional(),
    uom: z.string().nullable().optional(),
    max_qty: z.union([z.number(), z.string(), z.null()]).optional(),
    special_price: z.union([z.number(), z.string(), z.null()]).optional(),
    special_from_date: z.string().nullable().optional(),
    special_to_date: z.string().nullable().optional(),
    price_range: z
      .object({
        minimum_price: z
          .object({
            regular_price: moneySchema.optional(),
            final_price: moneySchema.optional(),
            discount: z
              .object({
                percent_off: z.union([z.number(), z.string(), z.null()]).optional(),
                amount_off: z.union([z.number(), z.string(), z.null()]).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    small_image: z
      .object({
        url: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    product_link: z.string().nullable().optional(),
    url_key: z.string().nullable().optional(),
    __typename: z.string().nullable().optional(),
  })
  .passthrough();

export type SourceProduct = z.infer<typeof sourceProductSchema>;

export const graphqlResponseSchema = z
  .object({
    data: z
      .object({
        unbxdProducts: z
          .object({
            items: z.array(z.unknown()).nullable().optional(),
            total_count: z.number().nullable().optional(),
            page_info: z
              .object({
                current_page: z.number().nullable().optional(),
                page_size: z.number().nullable().optional(),
                total_pages: z.number().nullable().optional(),
              })
              .passthrough()
              .nullable()
              .optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    errors: z
      .array(
        z
          .object({
            message: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type GraphqlResponse = z.infer<typeof graphqlResponseSchema>;
