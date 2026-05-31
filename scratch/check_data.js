const admin = require('firebase-admin');

// No service account needed if running in environment with ADC or if I just want to see if I can use the local credentials
// But I'll use the simplest way: try to list some docs
admin.initializeApp({
  projectId: 'lincoln-eats-77229'
});

const db = admin.firestore();

async function check() {
  console.log('Fetching documents from legacy collection...');
  const snapshot = await db.collection('saved_places').limit(5).get();
  
  if (snapshot.empty) {
    console.log('No documents found.');
    return;
  }

  snapshot.forEach(doc => {
    console.log(`Document ID: ${doc.id}`);
    console.log('Keys:', Object.keys(doc.data()));
    console.log('Content:', JSON.stringify(doc.data(), null, 2));
    console.log('---');
  });
}

check().catch(console.error);
