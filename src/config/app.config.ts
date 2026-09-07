const isProduction = process.env.NODE_ENV === 'production';
const developmentOnly = <T>(value: T): T | undefined =>
  isProduction ? undefined : value;

export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    uri:
      process.env.MONGO_URI ||
      developmentOnly('mongodb://127.0.0.1:27017/keibo_development'),
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRY || '15m',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET,
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d',
  },
  blockchain: {
    enabled: process.env.BLOCKCHAIN_FEATURES_ENABLED === 'true',
    rpcUrl: process.env.RPC_URL,
    chainId: process.env.CHAIN_ID
      ? parseInt(process.env.CHAIN_ID, 10)
      : undefined,
    chainName: process.env.CHAIN_NAME,
    contracts: {
      escrow: process.env.ESCROW_CONTRACT_ADDRESS,
      nft: process.env.NFT_CONTRACT_ADDRESS,
      voting: process.env.VOTING_CONTRACT_ADDRESS,
      dealRoom: process.env.DEALROOM_CONTRACT_ADDRESS,
      treasury: process.env.TREASURY_CONTRACT_ADDRESS,
    },
    signerProvider: process.env.PLATFORM_SIGNER_PROVIDER || 'disabled',
  },
  cors: {
    origin:
      process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ||
      developmentOnly(['http://localhost:3000', 'http://localhost:3001']) ||
      [],
  },
});
