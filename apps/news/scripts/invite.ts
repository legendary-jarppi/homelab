// Creates a single-use invite and prints its join URL. Bootstraps the first admin:
//   node --experimental-strip-types scripts/invite.ts --role admin --note "Jari"
import { parseArgs } from 'node:util';
import { createInvite } from '../src/lib/core/auth.ts';
import { db } from '../src/lib/core/db.ts';

const { values } = parseArgs({
	options: {
		role: { type: 'string', default: 'reader' },
		note: { type: 'string' },
		base: { type: 'string', default: process.env.PUBLIC_BASE_URL ?? 'http://news.lab.internal' }
	}
});

if (values.role !== 'reader' && values.role !== 'admin') {
	console.error('--role must be reader or admin');
	process.exit(2);
}

const sql = db();
try {
	const code = await createInvite(sql, { createdBy: null, role: values.role, note: values.note });
	console.log(`${values.base.replace(/\/+$/, '')}/join/${code}`);
	console.log(`role: ${values.role}; single use; expires in 14 days`);
} finally {
	await sql.end();
}
