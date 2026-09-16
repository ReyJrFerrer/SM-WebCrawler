export const GET_CATEGORY_PRODUCTS_QUERY = `query GetCategoryProducts(
  $categoryId: String!
  $pageSize: Int!
  $currentPage: Int!
) {
  unbxdProducts(
    filter: { category_id: { eq: $categoryId } }
    pageSize: $pageSize
    currentPage: $currentPage
  ) {
    items {
      id
      uid
      sku
      name
      uom
      max_qty
      special_price
      special_from_date
      special_to_date
      price_range {
        minimum_price {
          regular_price { value currency }
          final_price { value currency }
          discount { percent_off amount_off }
        }
      }
      small_image { url }
      product_link
      url_key
      __typename
    }
    total_count
    page_info {
      current_page
      page_size
      total_pages
    }
  }
}`;

export const GET_CATEGORY_PRODUCTS_OPERATION = "GetCategoryProducts";
