import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

async function main() {
  console.log('Seeding database...');

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const isProduction = process.env.NODE_ENV === 'production';

  // The admin password must be supplied via env. We never ship a hardcoded
  // default credential — in production a missing password is a hard error.
  let password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    if (isProduction) {
      throw new Error('SEED_ADMIN_PASSWORD must be set when seeding in production.');
    }
    // Dev convenience: generate a random one-time password and print it.
    password = randomBytes(12).toString('base64url');
    console.warn('[seed] SEED_ADMIN_PASSWORD not set — generated a random dev password (shown once below).');
  }
  if (password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters.');
  }

  // Check if admin exists
  const existingAdmin = await prisma.admin.findFirst({
    where: { email },
  });

  if (existingAdmin) {
    console.log('Admin already exists:', existingAdmin.email);
    return;
  }

  // Create admin
  const admin = await prisma.admin.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: 'SUPERADMIN',
    },
  });

  console.log('Created admin:', admin.email);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('Generated password:', password);
  }
  console.log('IMPORTANT: Change password after first login!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
