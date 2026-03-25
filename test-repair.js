const { MongoClient, ObjectId } = require('mongodb');
async function test() {
  const client = await MongoClient.connect('mongodb://localhost:27017/truden_crowdfunding');
  const db = client.db();
  
  const projects = await db.collection('projects').find().toArray();
  console.log('Projects:', projects.map(p => ({ id: p._id, creatorId: p.creatorId, raised: p.raisedAmount, type: p.projectType })));
  
  const users = await db.collection('users').find().toArray();
  console.log('Users:', users.map(u => ({ id: u._id, email: u.email })));

  const wallets = await db.collection('wallets').find().toArray();
  console.log('Wallets:', wallets.map(w => ({ id: w._id, userId: w.userId, fiat: w.fiatBalance })));

  await client.close();
}
test().catch(console.error);
