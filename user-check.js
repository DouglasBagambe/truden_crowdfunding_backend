const { MongoClient } = require('mongodb');
async function test() {
  const c = await MongoClient.connect('mongodb://localhost:27017/truden_crowdfunding');
  const db = c.db();
  const u = await db.collection('users').findOne({ email: 'douglasbagambe4@gmail.com' });
  console.log('User:', u._id);
  const projects = await db.collection('projects').find({ creatorId: u._id }).toArray();
  console.log('Projects created by user:', projects.map(p => ({ title: p.title || p.name, raised: p.raisedAmount, creatorId: p.creatorId })));
  
  // also check with string
  const projects2 = await db.collection('projects').find({ creatorId: u._id.toString() }).toArray();
  console.log('Projects by string id:', projects2.map(p => ({ title: p.title || p.name, raised: p.raisedAmount })));
  
  // check wallets
  const w = await db.collection('wallets').find({ userId: { $in: [u._id, u._id.toString()] } }).toArray();
  console.log('Wallet:', JSON.stringify(w, null, 2));
  
  await c.close();
}
test().catch(console.error);
