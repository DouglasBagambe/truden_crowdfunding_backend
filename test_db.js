const { connect } = require('mongoose');
require('dotenv').config({ path: '.env' });

async function run() {
    const db = await connect(process.env.MONGO_URI);
    const txs = await db.connection.collection('paymenttransactions').find().sort({ createdAt: -1 }).limit(5).toArray();

    for (const tx of txs) {
        if (tx.status === 'SUCCESSFUL' || tx.status === 'successful') {
            const user = await db.connection.collection('users').findOne({ _id: tx.userId });
            const project = await db.connection.collection('projects').findOne({ _id: tx.projectId });

            let creatorWallet = null;
            if (project && project.creatorId) {
                creatorWallet = await db.connection.collection('wallets').findOne({ userId: project.creatorId });
            }

            console.log('--- TX ---');
            console.log('amount:', tx.amount);
            console.log('project_creatorId:', project ? project.creatorId : 'none');
            console.log('creator_wallet fiat:', creatorWallet ? creatorWallet.fiatBalance : 'no wallet found');
        }
    }

    process.exit(0);
}
run();
