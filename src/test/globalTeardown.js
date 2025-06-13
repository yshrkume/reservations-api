const fs = require('fs');

module.exports = async () => {
  if (fs.existsSync('./test.db')) {
    fs.unlinkSync('./test.db');
  }
  if (fs.existsSync('./schema.test.prisma')) {
    fs.unlinkSync('./schema.test.prisma');
  }
};