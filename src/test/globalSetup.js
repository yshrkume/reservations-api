const { execSync } = require('child_process');
const fs = require('fs');

module.exports = async () => {
  if (fs.existsSync('./test.db')) {
    fs.unlinkSync('./test.db');
  }
  
  process.env.DATABASE_URL = 'file:./test.db';
  
  const schemaContent = fs.readFileSync('./schema.prisma', 'utf8');
  let testSchema = schemaContent
    .replace('provider = "postgresql"', 'provider = "sqlite"')
    .replace(/@db\.Date/g, '')
    .replace(/@db\.SmallInt/g, '')
    .replace(/status\s+ReservationStatus\s+@default\(CONFIRMED\)/, 'status String @default("CONFIRMED")')
    .replace(/enum ReservationStatus \{[\s\S]*?\}/, '');
  
  fs.writeFileSync('./schema.test.prisma', testSchema);
  
  execSync('npx prisma db push --schema=./schema.test.prisma', { 
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' }
  });
};