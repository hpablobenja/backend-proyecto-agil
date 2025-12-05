// routes/reportes.js
import express from 'express';
import pool from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js'; // Importa el middleware de Admin
import PDFDocument from 'pdfkit'; 

const router = express.Router();

// Función auxiliar para configurar la respuesta de descarga de PDF
const sendPdfResponse = (req, res, doc, filename) => {
  res.setHeader('Content-Type', 'application/pdf');

  // Usamos el rol del usuario en req.user para asegurar la descarga segura
  const rol = (req.user && req.user.role) ? `_${req.user.role}` : '';
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${filename}${rol}_${new Date().toISOString().split('T')[0]}.pdf`
  );

  doc.pipe(res);
  doc.end();
};

router.get('/data', async (req, res) => {
  try {
    const { periodo = 'dia', fecha_desde, fecha_hasta } = req.query;

    // Definir agrupamiento según periodo, ajustando a hora boliviana
    let groupBy;
    if (periodo === 'semana') {
      groupBy = "date_trunc('week', fecha AT TIME ZONE 'America/La_Paz')";
    } else if (periodo === 'mes') {
      groupBy = "date_trunc('month', fecha AT TIME ZONE 'America/La_Paz')";
    } else {
      groupBy = "date(fecha AT TIME ZONE 'America/La_Paz')";
    }

    // Construir query dinámicamente
    let query = `
      SELECT ${groupBy} as periodo,
             COUNT(*) as total_ventas,
             SUM(total) as total_ventas_monto
      FROM helados_heleta.ventas
      WHERE 1=1
    `;
    const params = [];

    if (fecha_desde) {
      params.push(fecha_desde);
      query += ` AND (fecha AT TIME ZONE 'America/La_Paz')::date >= $${params.length}`;
    }
    if (fecha_hasta) {
      params.push(fecha_hasta);
      query += ` AND (fecha AT TIME ZONE 'America/La_Paz')::date <= $${params.length}`;
    }
    if (periodo === 'dia' && !fecha_desde && !fecha_hasta) {
      query += ` AND (fecha AT TIME ZONE 'America/La_Paz')::date = CURRENT_DATE`;
    }

    query += ` GROUP BY ${groupBy} ORDER BY periodo DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al generar reporte' });
  }
});
// ====================================================================
// 1. Reporte de VENTAS (Protegido por authenticateToken en server.js)
// ====================================================================
router.get('/ventas', async (req, res) => {
    try {
        const { fecha_desde, fecha_hasta } = req.query;
        let query = `
          SELECT 
            v.id, v.fecha, v.total, v.tipo_pago, u.username,
            json_agg(
              json_build_object(
                'producto', p.nombre,
                'cantidad', dv.cantidad,
                'precio', dv.precio_unitario,
                'subtotal', dv.subtotal
              )
            ) as detalles
          FROM helados_heleta.ventas v
          LEFT JOIN helados_heleta.detalles_ventas dv ON v.id = dv.venta_id
          LEFT JOIN helados_heleta.productos p ON dv.producto_id = p.id
          LEFT JOIN helados_heleta.usuarios u ON v.usuario_id = u.id
          WHERE 1=1
        `;
        const params = [];

        if (fecha_desde) {
          query += ` AND v.fecha::date >= $${params.length + 1}`;
          params.push(fecha_desde);
        }
        if (fecha_hasta) {
          query += ` AND v.fecha::date <= $${params.length + 1}`;
          params.push(fecha_hasta);
        }

        query += ` GROUP BY v.id, u.username ORDER BY v.fecha DESC`;

        const result = await pool.query(query, params);
        
        // --- Generación del PDF ---
        const doc = new PDFDocument({ margin: 30 });
        doc.fontSize(18).text('Reporte de Ventas (Detallado)', { align: 'center' }).moveDown(0.5);
        doc.fontSize(10).text(`Período: ${fecha_desde || 'Inicio'} hasta ${fecha_hasta || 'Hoy'}`).moveDown(1);
        
        let contadorVentas = 0; 

        result.rows.forEach(venta => {
            contadorVentas++; 
            const fecha = new Date(venta.fecha).toLocaleString('es-ES');
            
            // Título de la venta (Mantiene la alineación izquierda ya corregida)
            doc.fontSize(12).fillColor('#3F51B5').text(`N° ${contadorVentas} | Total: Bs. ${Number(venta.total).toFixed(2)}`, 30, doc.y, { continued: true });
            doc.fillColor('black').fontSize(10).text(` (Vendedor: ${venta.username} - ${fecha})`, { continued: false }).moveDown(0.5);
            doc.fillColor('black').fontSize(10).text(` (Tipo_venta: ${venta.tipo_pago})`, { continued: false }).moveDown(0.5);
            // --- CABECERA DE DETALLES (CORREGIDA) ---
            doc.fontSize(9).font('Helvetica-Bold');
            const headerY = doc.y; // ⭐ Capturar Y inicial para la cabecera
            const lineAdvance = 12; // Avance manual (altura aproximada de una línea con font size 9)

            // Dibujar todos los títulos en la misma coordenada Y fija, SIN 'continued: true'
            doc.text('Producto', 50, headerY, { width: 150, align: 'left' });
            doc.text('Cant.', 210, headerY, { width: 50, align: 'center' });
            doc.text('P. Unitario', 270, headerY, { width: 80, align: 'center' });
            doc.text('Subtotal', 360, headerY, { width: 80, align: 'right' });

            // ⭐ Avanzar cursor Y manualmente para que la línea separadora y las filas de detalles empiecen correctamente
            doc.y = headerY + lineAdvance;

            doc.font('Helvetica');
            doc.moveTo(30, doc.y).lineTo(550, doc.y).stroke().moveDown(0.2); 

            // --- FILAS DE DETALLES (Lógica robusta) ---
            venta.detalles.forEach(d => {
                const productHeight = doc.heightOfString(d.producto, { width: 150, fontSize: 9 });
                const startY = doc.y;
                let nextY = startY + productHeight + 2; 

                doc.text(d.producto, 50, startY, { width: 150, align: 'left' });
                doc.text(d.cantidad.toString(), 210, startY, { width: 50, align: 'center' });
                doc.text(`Bs. ${Number(d.precio).toFixed(2)}`, 270, startY, { width: 80, align: 'center' });
                doc.text(`Bs. ${Number(d.subtotal).toFixed(2)}`, 360, startY, { width: 80, align: 'right' });
                
                doc.y = nextY;
                
                doc.moveTo(50, doc.y).lineTo(440, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke().moveDown(0.2);
                doc.strokeColor('black').lineWidth(1);
            });
            doc.moveDown(1);
        });

        sendPdfResponse(req, res, doc, 'reporte_ventas');

    } catch (error) {
        console.error("Error al generar reporte de ventas:", error);
        res.status(500).json({ error: 'Error al generar reporte de ventas' });
    }
});

// ====================================================================
// 2. Reporte de INVENTARIO (Stock Actual)
// ====================================================================
router.get('/inventario', async (req, res) => {
    try {
        const result = await pool.query(`
          SELECT 
            id, nombre, stock_actual, precio, categoria
          FROM helados_heleta.productos
          ORDER BY stock_actual DESC
        `);

        // --- Generación del PDF ---
        const doc = new PDFDocument({ margin: 30 });
        doc.fontSize(16).text('Reporte de Inventario (Stock Actual)', { align: 'center' }).moveDown(1);

        // --- CABECERA (Corregida con Posicionamiento Fijo) ---
        doc.fontSize(10).font('Helvetica-Bold');
        const headerYInventario = doc.y; // Capturar Y inicial
        const lineAdvance = 14; // Avance manual para font size 10

        // Dibujar todos los títulos en la misma coordenada Y fija, sin continued: true/false
        doc.text('N°', 50, headerYInventario, { width: 50 }); 
        doc.text('Producto', 110, headerYInventario, { width: 150 });
        doc.text('Categoría', 270, headerYInventario, { width: 100 });
        doc.text('Precio', 380, headerYInventario, { width: 80, align: 'right' });
        doc.text('Stock', 470, headerYInventario, { width: 80, align: 'right' });

        // Avanzar cursor Y manualmente
        doc.y = headerYInventario + lineAdvance;

        doc.moveTo(30, doc.y).lineTo(550, doc.y).stroke().moveDown(0.2);

        // Filas
        doc.font('Helvetica');
        let contadorInventario = 0; 
        result.rows.forEach(p => {
            contadorInventario++;
            const startY = doc.y;
            const textWidth = 150; 
            
            const productHeight = doc.heightOfString(p.nombre, { width: textWidth, fontSize: 10 });
            let nextY = startY + productHeight + 2; 

            doc.text(contadorInventario.toString(), 50, startY, { width: 50 });
            doc.text(p.nombre, 110, startY, { width: textWidth }); 
            doc.text(p.categoria, 270, startY, { width: 100 });
            doc.text(`Bs. ${Number(p.precio).toFixed(2)}`, 380, startY, { width: 80, align: 'right' });
            doc.text(p.stock_actual.toString(), 470, startY, { width: 80, align: 'right' });
            
            doc.y = nextY;
            doc.moveDown(0.1);
        });

        sendPdfResponse(req, res, doc, 'reporte_inventario');
    } catch (error) {
        console.error("Error al generar reporte de inventario:", error);
        res.status(500).json({ error: 'Error al generar reporte de inventario' });
    }
});

// ====================================================================
// 3. Reporte de PRODUCTOS (Maestro)
// ====================================================================
router.get('/productos', async (req, res) => {
    try {
        const result = await pool.query(`
          SELECT 
            id, nombre, precio, categoria, codigo_barra
          FROM helados_heleta.productos
          ORDER BY categoria, nombre ASC
        `);

        // --- Generación del PDF ---
        const doc = new PDFDocument({ margin: 30 });
        doc.fontSize(16).text('Reporte Maestro de Productos', { align: 'center' }).moveDown(1);
        
        // --- CABECERA (Corregida con Posicionamiento Fijo) ---
        doc.fontSize(10).font('Helvetica-Bold');
        const headerYProductos = doc.y; // Capturar Y inicial
        const lineAdvance = 14; // Avance manual para font size 10

        // Dibujar todos los títulos en la misma coordenada Y fija, sin continued: true/false
        doc.text('N°', 50, headerYProductos, { width: 50 });
        doc.text('Nombre', 110, headerYProductos, { width: 150 });
        doc.text('Categoría', 270, headerYProductos, { width: 100 });
        doc.text('Precio', 380, headerYProductos, { width: 80, align: 'right' });
        doc.text('Cód. Barra', 470, headerYProductos, { width: 80, align: 'right' });
        
        // Avanzar cursor Y manualmente
        doc.y = headerYProductos + lineAdvance;
        
        doc.moveTo(30, doc.y).lineTo(550, doc.y).stroke().moveDown(0.2);

        // Filas
        doc.font('Helvetica');
        let contadorProductos = 0; 
        result.rows.forEach(p => {
            contadorProductos++;
            const startY = doc.y;
            const textWidth = 150; 
            
            const nameHeight = doc.heightOfString(p.nombre, { width: textWidth, fontSize: 10 });
            let nextY = startY + nameHeight + 2; 

            doc.text(contadorProductos.toString(), 50, startY, { width: 50 });
            doc.text(p.nombre, 110, startY, { width: textWidth }); 
            doc.text(p.categoria, 270, startY, { width: 100 });
            doc.text(`Bs. ${Number(p.precio).toFixed(2)}`, 380, startY, { width: 80, align: 'right' });
            doc.text(p.codigo_barra || 'N/A', 470, startY, { width: 80, align: 'right' });
            
            doc.y = nextY;
            doc.moveDown(0.1);
        });

        sendPdfResponse(req, res, doc, 'reporte_productos');
    } catch (error) {
        console.error("Error al generar reporte de productos:", error);
        res.status(500).json({ error: 'Error al generar reporte de productos' });
    }
});


// ====================================================================
// 4. Reporte de USUARIOS (Solo Admin)
// ====================================================================
// Aquí se aplica el middleware requireAdmin
router.get('/usuarios', requireAdmin, async (req, res) => { 
    try {
        const result = await pool.query(`
          SELECT 
            id, username, email, role, created_at
          FROM helados_heleta.usuarios
          ORDER BY role, username ASC
        `);

        // --- Generación del PDF ---
        const doc = new PDFDocument({ margin: 30 });
        doc.fontSize(16).text('Reporte de Usuarios del Sistema', { align: 'center' }).moveDown(1);
        
        // --- CABECERA (Corregida con Posicionamiento Fijo) ---
        doc.fontSize(10).font('Helvetica-Bold');
        const headerYUsuarios = doc.y; // Capturar Y inicial
        const lineAdvance = 14; // Avance manual para font size 10

        // Dibujar todos los títulos en la misma coordenada Y fija, sin continued: true/false
        doc.text('N°', 50, headerYUsuarios, { width: 50 });
        doc.text('Usuario', 110, headerYUsuarios, { width: 100 });
        doc.text('Email', 220, headerYUsuarios, { width: 180 });
        doc.text('Rol', 410, headerYUsuarios, { width: 50 });
        doc.text('Creación', 470, headerYUsuarios, { width: 80 });

        // Avanzar cursor Y manualmente
        doc.y = headerYUsuarios + lineAdvance;
        
        doc.moveTo(30, doc.y).lineTo(550, doc.y).stroke().moveDown(0.2);

        // Filas
        doc.font('Helvetica');
        let contadorUsuarios = 0; 
        result.rows.forEach(u => {
            contadorUsuarios++;
            const startY = doc.y;
            const emailWidth = 180; 
            
            const emailHeight = doc.heightOfString(u.email, { width: emailWidth, fontSize: 10 });
            let nextY = startY + emailHeight + 2; 
            const fecha = new Date(u.created_at).toLocaleDateString('es-ES');

            doc.text(contadorUsuarios.toString(), 50, startY, { width: 50 });
            doc.text(u.username, 110, startY, { width: 100 }); 
            doc.text(u.email, 220, startY, { width: emailWidth }); 
            doc.text(u.role, 410, startY, { width: 50 });
            doc.text(fecha, 470, startY, { width: 80 });
            
            doc.y = nextY;
            doc.moveDown(0.1);
        });

        sendPdfResponse(req, res, doc, 'reporte_usuarios');
    } catch (error) {
        console.error("Error al generar reporte de usuarios:", error);
        res.status(500).json({ error: 'Error al generar reporte de usuarios' });
    }
});

export default router;