const admin = require('firebase-admin');
const fs = require('fs');

admin.initializeApp({
  projectId: 'lincoln-eats-77229'
});

async function main() {
  const snapshot = await admin.firestore().collection('saved_places').get();
  let count = 0;
  let out = '';
  snapshot.forEach(doc => {
    if (doc.data().user_rating !== undefined) {
      out += `${doc.id} rating: ${doc.data().user_rating} type: ${typeof doc.data().user_rating}\n`;
      count++;
    }
  });
  out += `Total with ratings: ${count}\n`;
  fs.writeFileSync('output.txt', out);
  process.exit(0);
}
main().catch(e => {
  fs.writeFileSync('output.txt', e.toString());
  process.exit(1);
});
