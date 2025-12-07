import express from 'express';
import pool from '../config/database.js';
import { z } from 'zod';

const router = express.Router();

// Middleware de autenticación (requiere que el token ya haya sido verificado y req.user esté seteado)
const requireAuth = (req, res, next) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Autenticación requerida.' });
    }
    next();
};

// Aplicar autenticación a todas las rutas de ventas
router.use(requireAuth);

const ventaSchema = z.object({
  detalles: z.array(z.object({
    producto_id: z.string(),
    cantidad: z.number().int().positive(),
    precio_unitario: z.number().positive().optional()
  })).min(1),
  // NUEVO CAMPO AGREGADO
  tipo_pago: z.enum(['efectivo', 'tarjeta', 'transferencia', 'otro']).default('efectivo').optional()
});

// POST /api/ventas - Registrar venta (CORREGIDO)
router.post('/', async (req, res) => {
  const client = await pool.connect(); // Usamos un cliente para transacción
  try {
    // Validar y obtener detalles y tipo_pago
    const { detalles, tipo_pago } = ventaSchema.parse(req.body);

    await client.query('BEGIN'); // Iniciar transacción

    // 1. Verificar stock, calcular total y obtener detallesValidos
    let total = 0;
    const detallesValidos = [];

    for (const detalle of detalles) {
      const productoResult = await client.query(
        'SELECT id, nombre, precio, stock_actual FROM helados_heleta.productos WHERE id = $1 FOR UPDATE',
        [detalle.producto_id]
      );

      const producto = productoResult.rows[0];
      if (!producto) {
        throw new Error(`Producto no encontrado: ${detalle.producto_id}`);
      }

      if (producto.stock_actual < detalle.cantidad) {
        // Incluye el nombre del producto en el error para mejor UX
        throw new Error(`Stock insuficiente para ${producto.nombre}. Disponible: ${producto.stock_actual}`);
      }
      
      const precio = detalle.precio_unitario || producto.precio;
      total += detalle.cantidad * precio;

      detallesValidos.push({
        ...detalle,
        precio_unitario: precio,
        nombre: producto.nombre
      });
      
      await client.query(
      `INSERT INTO helados_heleta.movimientos_inventario 
       (producto_id, tipo, cantidad, motivo, usuario_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [detalle.producto_id, "salida", detalle.cantidad, "Venta", req.user.id]
    );
      // 2. Actualizar stock inmediatamente
      await client.query(
        'UPDATE helados_heleta.productos SET stock_actual = stock_actual - $1 WHERE id = $2',
        [detalle.cantidad, detalle.producto_id]
      );
    }

    // 3. Insertar la venta principal, incluyendo TIPO_PAGO
 
    const ventaResult = await client.query(
      'INSERT INTO helados_heleta.ventas (total, usuario_id, tipo_pago) VALUES ($1, $2, $3) RETURNING *',
      [total, req.user.id, tipo_pago]
    );

    const venta = ventaResult.rows[0];
    // 4. Insertar detalles de venta
    for (const detalle of detallesValidos) {
      await client.query(
        `INSERT INTO helados_heleta.detalles_ventas 
         (venta_id, producto_id, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4)`,
        [venta.id, detalle.producto_id, detalle.cantidad, detalle.precio_unitario]
      );
    }

    // 5. Commit de la transacción
    await client.query('COMMIT');

    res.status(201).json({ 
      ...ventaResult.rows[0],
      detalles: detallesValidos, // Opcional: devolver los detalles
      message: 'Venta registrada exitosamente' 
    });

  } catch (error) {
    await client.query('ROLLBACK'); // Revertir si algo falla
    console.error('Error al registrar venta (ROLLBACK):', error.message || error);
    const errorMessage = error.message.includes('Stock insuficiente') 
      ? error.message 
      : 'Error al procesar la venta. Verifique los datos.';
      
    res.status(400).json({ error: errorMessage });
  } finally {
    client.release();
  }
});

// GET /api/ventas - Listar ventas (CORREGIDO: Incluye tipo_pago)
router.get('/', async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, limit = 20 } = req.query;
    let query = `
      SELECT 
        v.*, 
        u.username,
        COUNT(dv.id) AS items_count,
        SUM(dv.subtotal) AS total_real,
        COALESCE(
          json_agg(
            json_build_object(
              'id', dv.id,
              'producto_id', dv.producto_id,
              'cantidad', dv.cantidad,
              'precio_unitario', dv.precio_unitario,
              'subtotal', dv.subtotal,
              'nombre', p.nombre
            )
          ) FILTER (WHERE dv.id IS NOT NULL),
          '[]'
        ) AS detalles
      FROM helados_heleta.ventas v
      LEFT JOIN helados_heleta.detalles_ventas dv ON v.id = dv.venta_id
      LEFT JOIN helados_heleta.productos p ON dv.producto_id = p.id
      LEFT JOIN helados_heleta.usuarios u ON v.usuario_id = u.id
      WHERE 1=1

    `;
    const params = [];

    if (fecha_desde) {
      query += ` AND v.fecha >= $${params.length + 1}`;
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      query += ` AND v.fecha <= $${params.length + 1}`;
      params.push(fecha_hasta);
    }

    query += ` GROUP BY v.id, u.username ORDER BY v.fecha DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener ventas:', error);
    res.status(500).json({ error: 'Error al obtener ventas' });
  }
});

// GET /api/ventas/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        v.*, 
        u.username,
        json_agg(
          json_build_object(
            'id', dv.id,
            'producto_id', dv.producto_id,
            'cantidad', dv.cantidad,
            'precio_unitario', dv.precio_unitario,
            'subtotal', dv.subtotal,
            'nombre', p.nombre
          )
        ) as detalles
      FROM helados_heleta.ventas v
      LEFT JOIN helados_heleta.detalles_ventas dv ON v.id = dv.venta_id
      LEFT JOIN helados_heleta.productos p ON dv.producto_id = p.id
      LEFT JOIN helados_heleta.usuarios u ON v.usuario_id = u.id
      WHERE v.id = $1
      GROUP BY v.id, u.username
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener detalle de venta:', error);
    res.status(500).json({ error: 'Error al obtener detalle de venta' });
  }
});

export default router;