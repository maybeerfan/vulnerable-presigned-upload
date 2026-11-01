const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { typeDefs } = require('./schema');

const PORT = process.env.PORT || 4000;

// Client for internal operations (list, delete, etc.)
const s3ClientInternal = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Client used ONLY for generating presigned URLs that the browser will call
const s3ClientPublic = new S3Client({
  endpoint: process.env.PUBLIC_MINIO_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

function checkAuth(context) {
  const authHeader = context.req.headers.authorization || '';
  const expected = 'Basic ' + Buffer.from('labuser:labpass123').toString('base64');
  if (authHeader !== expected) {
    throw new Error('Unauthorized');
  }
}

const resolvers = {
  Query: {
    requestAssetUpload: async (_parent, { contentType, secure }, context) => {
      checkAuth(context);

      const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
      if (!allowed.includes(contentType)) {
        throw new Error('Content type not allowed');
      }

      const fileId = uuidv4();
      const key = `${fileId}.png`;

      const command = new PutObjectCommand({
        Bucket: process.env.MINIO_BUCKET,
        Key: key,
        ContentType: contentType,
      });

      const signOptions = {
        expiresIn: 3600,
      };

      // If secure mode is enabled, force Content-Type to be part of the signature
      if (secure) {
        signOptions.signableHeaders = new Set(['content-type']);
      }

      const uploadUrl = await getSignedUrl(s3ClientPublic, command, signOptions);

      const cdnUrl = `${process.env.CDN_BASE_URL}/${key}`;

      return {
        uploadUrl,
        cdnUrl,
      };
    },

    listAssets: async (_parent, _args, context) => {
      checkAuth(context);

      const command = new ListObjectsV2Command({
        Bucket: process.env.MINIO_BUCKET,
      });

      const response = await s3ClientInternal.send(command);
      const contents = response.Contents || [];

      return contents.map((item) => ({
        key: item.Key,
        cdnUrl: `${process.env.CDN_BASE_URL}/${item.Key}`,
      }));
    },
  },

  Mutation: {
    deleteAllAssets: async (_parent, _args, context) => {
      checkAuth(context);

      // First list all objects
      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.MINIO_BUCKET,
      });

      const listResponse = await s3ClientInternal.send(listCommand);
      const contents = listResponse.Contents || [];

      if (contents.length === 0) {
        return true;
      }

      // Delete them all
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: process.env.MINIO_BUCKET,
        Delete: {
          Objects: contents.map((item) => ({ Key: item.Key })),
          Quiet: true,
        },
      });

      await s3ClientInternal.send(deleteCommand);
      return true;
    },
  },
};

async function start() {
  const app = express();
  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  await server.start();

  app.use(
    '/graphql',
    cors({ origin: true }),
    express.json(),
    expressMiddleware(server, {
      context: async ({ req }) => ({ req }),
    })
  );

  app.listen(PORT, () => {
    console.log(`GraphQL server ready at http://upload.erfan.net/graphql`);
  });
}

start();