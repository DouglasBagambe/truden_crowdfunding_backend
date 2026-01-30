export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/crowdfunding_db',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-key',
    expiresIn: process.env.JWT_EXPIRY || '15m',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'default-refresh-secret',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  },
  blockchain: {
    rpcUrl:
      process.env.RPC_URL ||
      'https://base-sepolia.blockpi.network/v1/rpc/public',
    chainId: parseInt(process.env.CHAIN_ID ?? '84532', 10) || 84532,
    chainName: process.env.CHAIN_NAME || 'Base Sepolia',
    contracts: {
      escrow: process.env.ESCROW_CONTRACT_ADDRESS,
      nft: process.env.NFT_CONTRACT_ADDRESS,
      voting: process.env.VOTING_CONTRACT_ADDRESS,
      dealRoom: process.env.DEALROOM_CONTRACT_ADDRESS,
      treasury: process.env.TREASURY_CONTRACT_ADDRESS,
    },
    adminPrivateKey: process.env.ADMIN_PRIVATE_KEY,
  },
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  },
});
