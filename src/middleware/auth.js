import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    
    const result = await pool.query(
      'SELECT id, username, role FROM helados_heleta.usuarios WHERE id = $1',
      [user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Usuario no encontrado' });
    }
    
    req.user = result.rows[0];
    next();
  });
};

export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: requiere rol de administrador' });
  }
  next();
};