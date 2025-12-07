import express from 'express';
import pool from '../config/database.js';
import { z } from 'zod';

const router = express.Router();

const movimientoSchema = z.object({
  producto_id: z.string(),
  cantidad: z.number().int().positive(),
  motivo: z.string().optional()
});

// POST /api/inventario/movimiento - Registrar entrada/salida
router.post('/movimiento', async (req, res) => {
  try {
    const { producto_id, cantidad, motivo, tipo = 'entrada' } = movimientoSchema.parse({
      ...req.body,
      tipo: req.body.tipo || 'entrada'
    });

    // Verificar stock suficiente para salidas
    if (tipo === 'entrada') {
    await pool.query(
      `UPDATE helados_heleta.productos
       SET stock_actual = stock_actual + $1
       WHERE id = $2`,
      [cantidad, producto_id]
        );
      }
    if (tipo === 'salida') {
      const stockResult = await pool.query(
        'SELECT stock_actual FROM helados_heleta.productos WHERE id = $1',
        [producto_id]
      );
      if (stockResult.rows[0]?.stock_actual < cantidad) {
        return res.status(400).json({ 
          error: 'Stock insuficiente',
          stock_actual: stockResult.rows[0]?.stock_actual 
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO helados_heleta.movimientos_inventario 
       (producto_id, tipo, cantidad, motivo, usuario_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [producto_id, tipo, cantidad, motivo, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar movimiento' });
  }
});

// GET /api/inventario/movimientos
router.get('/movimientos', async (req, res) => {
  try {
    const { producto_id, tipo, fecha_desde, fecha_hasta } = req.query;
    let query = `
      SELECT 
        mi.*,
        p.nombre as producto_nombre,
        u.username
      FROM helados_heleta.movimientos_inventario mi
      JOIN helados_heleta.productos p ON mi.producto_id = p.id
      JOIN helados_heleta.usuarios u ON mi.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (producto_id) {
      query += ` AND mi.producto_id = $${params.length + 1}`;
      params.push(producto_id);
    }
    if (tipo) {
      query += ` AND mi.tipo = $${params.length + 1}`;
      params.push(tipo);
    }
    if (fecha_desde) {
      query += ` AND mi.fecha >= $${params.length + 1}`;
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      query += ` AND mi.fecha <= $${params.length + 1}`;
      params.push(fecha_hasta);
    }

    query += ` ORDER BY mi.fecha DESC LIMIT 100`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener movimientos' });
  }
});

export default router;