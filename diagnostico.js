import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
});

async function diagnosticoCompleto() {
  console.log('🔍 === DIAGNÓSTICO HELADOS HELETA ===');
  
  try {
    // 1. CONEXIÓN DB
    console.log('1️⃣ Probando conexión...');
    const conn = await pool.query('SELECT NOW() as tiempo');
    console.log('✅ CONEXIÓN OK:', conn.rows[0].tiempo);

    // 2. TABLA USUARIOS
    console.log('\n2️⃣ Verificando tabla usuarios...');
    const tabla = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'helados_heleta' AND table_name = 'usuarios'
    `);
    console.log('📊 Tabla existe:', tabla.rows.length > 0 ? '✅ SÍ' : '❌ NO');

    // 3. USUARIOS
    console.log('\n3️⃣ Buscando usuarios...');
    const usuarios = await pool.query('SELECT username, role FROM helados_heleta.usuarios');
    console.log('👥 Usuarios encontrados:', usuarios.rows.length);
    usuarios.rows.forEach(u => console.log(`   - ${u.username} (${u.role})`));

    if (usuarios.rows.length === 0) {
      console.log('❌ ¡NO HAY USUARIOS! Ejecuta el SQL ahora.');
      return;
    }

    // 4. TEST HASHES
    console.log('\n4️⃣ Probando contraseñas...');
    const adminHash = '$2b$12$UXepPPexqxWc8Dr5XomBbuBSHBDH7Ln51ij/bJiPfMEst7TlTfWj6';
    const empHash = '$2b$12$tKRBKQX1Bg529ZgFnLbqvO4sPuOo1ZL996hsGS3ObmzutSQ2WPuei';
    
    const adminOK = await bcrypt.compare('admin', adminHash);
    const empOK = await bcrypt.compare('123456', empHash);
    
    console.log('🔑 admin/admin:', adminOK ? '✅ OK' : '❌ FALLA');
    console.log('🔑 empleado1/123456:', empOK ? '✅ OK' : '❌ FALLA');

    // 5. SIMULAR LOGIN
    console.log('\n5️⃣ Simulando login admin...');
    const login = await pool.query(`
      SELECT id, username, role 
      FROM helados_heleta.usuarios 
      WHERE username = 'admin'
    `);
    console.log('Login admin:', login.rows.length > 0 ? '✅ ENCONTRADO' : '❌ NO EXISTE');

  } catch (error) {
    console.error('💥 ERROR COMPLETO:', error.message);
    console.error('💥 ERROR DETALLADO:', error);
  } finally {
    await pool.end();
  }
}

diagnosticoCompleto();