const Papa = require('papaparse');
function exportParticipantsCSV(participants){
  const data = participants.map(p => ({ id: p.id, giveaway_id: p.giveaway_id, name: p.name, contact: p.contact, note: p.note, created_at: new Date(p.created_at).toISOString() }));
  return Papa.unparse(data);
}
module.exports = { exportParticipantsCSV };
