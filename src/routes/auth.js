import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { z } from 'zod';

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(4)
});

const registerSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6)
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    
    const result = await pool.query(
      'SELECT * FROM helados_heleta.usuarios WHERE username = $1',
      [username]
    );

    const user = result.rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.log(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Registro (solo admin)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role = 'empleado' } = registerSchema.parse(req.body);
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO helados_heleta.usuarios (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
      [username, email, passwordHash, role]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Usuario o email ya existe' });
    }
    res.status(500).json({ error: 'Error en el servidor' });
  }
});
// Lista de usuarios (solo admin)
router.get('/users', async (req, res) => {
  try {
    // Aquí podrías validar el token JWT si quieres restringir acceso
    // Ejemplo rápido: leer Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const token = authHeader.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido' });
    }

    // Solo admin puede ver lista
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Consulta a la base de datos
    const result = await pool.query(
      'SELECT id, username, email, role FROM helados_heleta.usuarios ORDER BY id ASC'
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});
export default router;