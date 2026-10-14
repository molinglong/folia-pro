import Database from 'better-sqlite3';
const db = new Database('./data/folia-sync-test.db', { readonly: true });
console.log('sessions:');
for (const r of db.prepare('SELECT s.user_id, u.email, s.created_at FROM sessions s JOIN users u ON u.user_id=s.user_id ORDER BY s.created_at').all()) {
    console.log(' ', r.email, r.created_at);
}
console.log('collections:');
for (const r of db.prepare('SELECT u.email, c.provider_id, c.updated_at, length(c.value_json) as bytes FROM collections c JOIN users u ON u.user_id=c.user_id ORDER BY c.updated_at').all()) {
    console.log(' ', r.email, r.provider_id, r.updated_at, r.bytes + 'B');
}
const q = db.prepare("SELECT c.value_json FROM collections c JOIN users u ON u.user_id=c.user_id WHERE u.email=? AND c.provider_id='qq'").get('admin@qq.com');
if (q) {
    const j = JSON.parse(q.value_json);
    console.log('qq@admin: user=' + (j.data.user && j.data.user.nickname) + ' collections=' + j.data.collections.length + ' liked=' + j.data.likedSongIds.length);
} else {
    console.log('qq@admin: (none)');
}
