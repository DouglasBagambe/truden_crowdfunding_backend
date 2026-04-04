const { MongoClient, ObjectId } = require('mongodb');

const PROD_MONGO = process.argv[2];
if (!PROD_MONGO) {
  console.log('Usage: node prod-fix.js <MONGO_URI>');
  process.exit(1);
}

async function fix() {
  const c = await MongoClient.connect(PROD_MONGO);
  const db = c.db();
  
  const USER_ID = new ObjectId('69af26b292bf0c98108eb75c');
  
  // Find all projects by this user
  const projects = await db.collection('projects').find({
    creatorId: { $in: [USER_ID, USER_ID.toString()] }
  }).toArray();
  
  console.log('Found projects:', projects.length);
  let totalCharity = 0, totalROI = 0;
  for (const p of projects) {
    const type = (p.projectType || '').toUpperCase();
    const raised = p.raisedAmount || 0;
    console.log(`  Project: ${p.name}, type: ${type}, raised: ${raised}`);
    if (type === 'CHARITY') totalCharity += raised;
    else if (type === 'ROI') totalROI += raised;
  }
  console.log(`Total charity: ${totalCharity}, Total ROI: ${totalROI}`);

  // Find wallet
  const wallet = await db.collection('wallets').findOne({
    userId: { $in: [USER_ID, USER_ID.toString()] }
  });
  console.log('Wallet found:', wallet ? wallet._id : 'NONE - creating');

  if (wallet) {
    await db.collection('wallets').updateOne(
      { _id: wallet._id },
      { $set: { 'fiatBalance.UGX': totalCharity, 'roiBalance.UGX': totalROI } }
    );
    console.log(`Updated wallet: fiat=${totalCharity}, roi=${totalROI}`);
  } else {
    // Create a new wallet
    const result = await db.collection('wallets').insertOne({
      userId: USER_ID,
      fiatBalance: { UGX: totalCharity, USD: 0 },
      roiBalance: { UGX: totalROI, USD: 0 },
      cryptoBalance: { ETH: 0, USDC: 0 },
      totalBalanceUSD: 0,
      withdrawalMethods: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Created new wallet: ${result.insertedId}`);
  }

  await c.close();
  console.log('Done!');
}

fix().catch(console.error);
