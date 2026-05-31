const admin = require('firebase-admin');

// No service account needed since ADC is likely available or default init works locally
// based on check_data.js in the same directory.
admin.initializeApp({
  projectId: 'lincoln-eats-77229'
});

const db = admin.firestore();

async function migrate() {
  console.log('Fetching documents from saved_places collection...');
  const snapshot = await db.collection('saved_places').get();
  
  if (snapshot.empty) {
    console.log('No documents found.');
    return;
  }

  const batch = db.batch();
  let count = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.user_rating !== undefined && data.user_rating !== null) {
      let newRating = null;
      if (data.user_rating === 5) newRating = 3; // Love
      else if (data.user_rating >= 2 && data.user_rating <= 4) newRating = 2; // Will go back
      else if (data.user_rating === 1) newRating = 1; // Skip it
      
      if (newRating !== null && newRating !== data.user_rating) {
        batch.update(doc.ref, { user_rating: newRating });
        count++;
      }
    }
  });

  if (count > 0) {
    console.log(`Migrating ${count} records...`);
    await batch.commit();
    console.log('Migration complete.');
  } else {
    console.log('No records needed migration.');
  }
}

migrate().catch(console.error);
