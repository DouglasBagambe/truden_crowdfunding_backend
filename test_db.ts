import { connect } from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function run() {
  const db = await connect(process.env.MONGO_URI as string);
  const txs = await db.connection.collection('paymenttransactions').find().sort({ createdAt: -1 }).limit(5).toArray();
  console.log('TXS:', JSON.stringify(txs, null, 2));

  for (const tx of txs) {
    if (tx.status === 'SUCCESSFUL' || tx.status === 'successful') {
      const user = await db.connection.collection('users').findOne({ _id: tx.userId });
      const wallet = await db.connection.collection('wallets').findOne({ userId: tx.userId });
      const project = await db.connection.collection('projects').findOne({ _id: tx.projectId });

      let creatorWallet: any = null;
      if (project && project.creatorId) {
        creatorWallet = await db.connection.collection('wallets').findOne({ userId: project.creatorId });
      }

      console.log('--- TX ---');
      console.log('txId:', tx._id);
      console.log('type:', (tx.metadata && tx.metadata.projectType) ? tx.metadata.projectType : 'missing');
      console.log('donor:', user ? user.email : 'unknown');
      console.log('creator_wallet:', creatorWallet ? creatorWallet.fiatBalance : 'no wallet found');
    }
  }

  process.exit(0);
}
run();
