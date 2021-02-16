import { NodeInput, SourceNodesArgs } from "gatsby";
import { IdentifiableRecord, NodeHelpers } from "gatsby-node-helpers";
import { createRemoteFileNode } from "gatsby-source-filesystem";

// 'gid://shopify/Metafield/6936247730264'
const pattern = /^gid:\/\/shopify\/(\w+)\/(.+)$/;

function attachParentId(obj: Record<string, any>) {
  if (obj.__parentId) {
    const [fullId, remoteType] = obj.__parentId.match(pattern) || [];
    const field = remoteType.charAt(0).toLowerCase() + remoteType.slice(1);
    const idField = `${field}Id`;
    obj[idField] = fullId;
    delete obj.__parentId;
  }
}

const downloadImageAndCreateFileNode = async (
  { url, nodeId }: { url: string; nodeId: string },
  {
    actions: { createNode, touchNode },
    createNodeId,
    cache,
    store,
    reporter,
  }: SourceNodesArgs
): Promise<string | undefined> => {
  const mediaDataCacheKey = `Shopify__Media__${url}`;
  const cacheMediaData = await cache.get(mediaDataCacheKey);

  if (cacheMediaData) {
    const fileNodeID = cacheMediaData.fileNodeID;
    touchNode({ nodeId: fileNodeID });
    return fileNodeID;
  }

  const fileNode = await createRemoteFileNode({
    url,
    cache,
    createNode,
    createNodeId,
    parentNodeId: nodeId,
    store,
    reporter,
  });

  if (fileNode) {
    const fileNodeID = fileNode.id;
    await cache.set(mediaDataCacheKey, { fileNodeID });
    return fileNodeID;
  }

  return undefined;
};

interface ProcessorMap {
  [remoteType: string]: (
    node: NodeInput,
    gatsbyApi: SourceNodesArgs,
    options: ShopifyPluginOptions
  ) => Promise<void>;
}

const processorMap: ProcessorMap = {
  LineItem: async (node) => {
    const lineItem = node;
    lineItem.productId = (lineItem.product as { id: string }).id;
    delete lineItem.product;
  },
  ProductImage: async (node, gatsbyApi, options) => {
    if (options.downloadImages) {
      const url = node.originalSrc as string;
      const fileNodeId = await downloadImageAndCreateFileNode(
        {
          url,
          nodeId: node.id,
        },
        gatsbyApi
      );

      node.localFile = fileNodeId;
    }
  },
  Product: async (node, gatsbyApi, options) => {
    if (options.downloadImages) {
      const featuredImage = node.featuredImage as
        | {
            originalSrc: string;
            localFile: string | undefined;
          }
        | undefined;

      if (featuredImage) {
        const url = featuredImage.originalSrc;
        const fileNodeId = await downloadImageAndCreateFileNode(
          {
            url,
            nodeId: node.id,
          },
          gatsbyApi
        );

        featuredImage.localFile = fileNodeId;
      }
    }
  },
};

async function buildFromId(
  obj: Record<string, any>,
  getFactory: (remoteType: string) => (node: IdentifiableRecord) => NodeInput,
  gatsbyApi: SourceNodesArgs,
  options: ShopifyPluginOptions
) {
  const [shopifyId, remoteType] = obj.id.match(pattern) || [];

  const Node = getFactory(remoteType);
  const processor = processorMap[remoteType] || (() => Promise.resolve());

  attachParentId(obj);
  const node = Node({ ...obj, id: shopifyId });
  await processor(node, gatsbyApi, options);

  return node;
}

export interface NodeBuilder {
  buildNode: (obj: Record<string, any>) => Promise<NodeInput>;
}

export function nodeBuilder(
  nodeHelpers: NodeHelpers,
  gatsbyApi: SourceNodesArgs,
  options: ShopifyPluginOptions
): NodeBuilder {
  const factoryMap: {
    [k: string]: (node: IdentifiableRecord) => NodeInput;
  } = {};
  const getFactory = (remoteType: string) => {
    if (!factoryMap[remoteType]) {
      factoryMap[remoteType] = nodeHelpers.createNodeFactory(remoteType);
    }
    return factoryMap[remoteType];
  };

  return {
    async buildNode(obj: Record<string, any>) {
      if (obj.id) {
        return await buildFromId(obj, getFactory, gatsbyApi, options);
      }

      throw new Error(`Cannot create a node without type information`);
    },
  };
}
