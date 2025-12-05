import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './config/database.js';
dotenv.config();
import reportesRouter from './routes/reportes.js';
import authRoutes from './routes/auth.js';
import productoRoutes from './routes/productos.js';
import inventarioRoutes from './routes/inventario.js';
import ventasRoutes from './routes/ventas.js';

import { authenticateToken, requireAdmin } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Rutas públicas
app.use('/api/auth', authRoutes);

// Rutas protegidas
app.use('/api/productos', authenticateToken, productoRoutes);
app.use('/api/inventario', authenticateToken, inventarioRoutes);
app.use('/api/ventas', authenticateToken, ventasRoutes);
app.use('/api/reportes', authenticateToken, reportesRouter);
// Ruta de dashboard
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const [
      productosTotal,
      stockBajo,
      ventasHoy,
      movimientosHoy
    ] = await Promise.all([
      req.user.role === 'admin' 
        ? pool.query('SELECT COUNT(*) as count FROM helados_heleta.productos')
        : pool.query('SELECT COUNT(*) as count FROM helados_heleta.productos WHERE stock_actual > 0'),
      
      pool.query(`
        SELECT COUNT(*) as count 
        FROM helados_heleta.productos 
        WHERE stock_actual <= 10 AND stock_actual > 0
      `),
      
      pool.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM helados_heleta.ventas 
        WHERE date(fecha) = CURRENT_DATE
      `),
      
      pool.query(`
        SELECT COUNT(*) as count
        FROM helados_heleta.movimientos_inventario 
        WHERE date(fecha) = CURRENT_DATE
      `)
    ]);

    res.json({
      totalProductos: Number(productosTotal.rows[0].count),
      stockBajo: Number(stockBajo.rows[0].count),
      ventasHoy: {
        count: Number(ventasHoy.rows[0].count),
        total: parseFloat(ventasHoy.rows[0].total)
      },
      movimientosHoy: Number(movimientosHoy.rows[0].count),
      user: req.user
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener dashboard' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});