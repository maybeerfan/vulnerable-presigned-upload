const typeDefs = `#graphql
  type AssetUploadUrl {
    uploadUrl: String!
    cdnUrl: String!
  }

  type Asset {
    key: String!
    cdnUrl: String!
  }

  type Query {
    requestAssetUpload(contentType: String!, secure: Boolean = false): AssetUploadUrl!
    listAssets: [Asset!]!
  }

  type Mutation {
    deleteAllAssets: Boolean!
  }
`;

module.exports = { typeDefs };