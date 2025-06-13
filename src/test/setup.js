const { PrismaClient } = require('@prisma/client');

let prisma;

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'file:./test.db'
      }
    }
  });
  await prisma.$connect();
});

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
});

beforeEach(async () => {
  await prisma.reservation.deleteMany({});
});

global.prisma = prisma;