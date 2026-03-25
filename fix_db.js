const { connect } = require('mongoose');
require('dotenv').config({ path: '.env' });

async function run() {
  const db = await connect(process.env.MONGO_URI);
  
  // 1. Find the project "ClearFlow Boreholes"
  const project = await db.connection.collection('projects').findOne({ name: /ClearFlow/i });
  if (project) {
    console.log("Found Project:", project.name, "Raised:", project.raisedAmount);
    
    // Check if the user's wallet has the balance
    if (project.creatorId) {
      const wallet = await db.connection.collection('wallets').findOne({ userId: project.creatorId });
      if (wallet) {
        console.log("Wallet before fix:", wallet.fiatBalance);
        // Fix the wallet balance
        if ((wallet.fiatBalance.UGX || 0) < project.raisedAmount) {
           wallet.fiatBalance.UGX = project.raisedAmount;
           await db.connection.collection('wallets').updateOne({ _id: wallet._id }, { $set: { fiatBalance: wallet.fiatBalance } });
           console.log("Wallet Fixed!");
        }
      } else {
        console.log("No wallet found for creator!");
      }
    }
  }

  // 2. Find any charitydonations missing userId and try to match donorName to users
  const donations = await db.connection.collection('charity_donations').find({ userId: { $exists: false } }).toArray();
  for (const don of donations) {
     if (don.donorName) {
         let user = await db.connection.collection('users').findOne({ email: don.donorName });
         if (!user) user = await db.connection.collection('users').findOne({ 'profile.displayName': don.donorName });
         
         if (user) {
             await db.connection.collection('charity_donations').updateOne({ _id: don._id }, { $set: { userId: user._id } });
             console.log("Linked donation to user:", user.email);
         } else {
             console.log("Could not find user for donorName:", don.donorName);
         }
     }
  }

  process.exit(0);
}
run();
