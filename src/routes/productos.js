import express from 'express';
import pool from '../config/database.js';
import { z } from 'zod';

const router = express.Router();

const productoSchema = z.object({
  nombre: z.string().min(3),
  descripcion: z.string().optional(),
  precio: z.number().positive(),
  categoria: z.string().min(2),
  codigo_barra: z.string().optional()
});

// GET /api/productos - Listar productos
router.get('/', async (req, res) => {
  try {
    const { categoria, search } = req.query;
    let query = `
      SELECT id, nombre, descripcion, precio, stock_actual, categoria, codigo_barra, created_at
      FROM helados_heleta.productos
      WHERE 1=1
    `;
    const params = [];

    if (categoria) {
      query += ` AND categoria ILIKE $${params.length + 1}`;
      params.push(`%${categoria}%`);
    }

    if (search) {
      query += ` AND (nombre ILIKE $${params.length + 1} OR codigo_barra ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY nombre`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// GET /api/productos/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM helados_heleta.productos WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// POST /api/productos
router.post('/', async (req, res) => {
  try {
    const data = productoSchema.parse(req.body);
    
    const result = await pool.query(
      `INSERT INTO helados_heleta.productos 
       (nombre, descripcion, precio, categoria, codigo_barra) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [data.nombre, data.descripcion, data.precio, data.categoria, data.codigo_barra]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Código de barras ya existe' });
    }
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/productos/:id
router.put('/:id', async (req, res) => {
  try {
    const data = productoSchema.partial().parse(req.body);
    const fields = Object.keys(data).map((key, index) => `${key} = $${index + 1}`).join(', ');
    const values = [...Object.values(data), req.params.id];

    const result = await pool.query(
      `UPDATE helados_heleta.productos 
       SET ${fields}, updated_at = NOW() 
       WHERE id = $${values.length} 
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// DELETE /api/productos/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM helados_heleta.productos WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

export default router;