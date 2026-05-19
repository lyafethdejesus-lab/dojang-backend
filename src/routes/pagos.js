const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, allow } = require('../middleware/auth');

// GET /api/pagos  — admin ve todos; responsable solo los suyos
router.get('/', auth, async (req, res) => {
  try {
    let query, params = [];
    if (req.user.rol === 'responsable') {
      query = `SELECT p.*, r.nombre AS responsable_nombre,
               m.mes_correspondiente, m.anio
               FROM pagos p 
               JOIN responsables r ON r.num_control = p.num_control_responsable
               LEFT JOIN mensualidades m ON m.id_pago = p.id_pago
               WHERE p.num_control_responsable = $1 ORDER BY p.fecha_pago DESC`;
      params = [req.user.id_responsable];
    } else {
      query = `SELECT p.*, r.nombre AS responsable_nombre,
               m.mes_correspondiente, m.anio
               FROM pagos p 
               JOIN responsables r ON r.num_control = p.num_control_responsable
               LEFT JOIN mensualidades m ON m.id_pago = p.id_pago
               ORDER BY p.fecha_pago DESC`;
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener pagos' });
  }
});

// POST /api/pagos  — registrar pago (mensualidad, equipo, examen…)
router.post('/', auth, allow('admin','instructor'), async (req, res) => {
  const { monto_total, monto_abonado = 0, fecha_pago, metodo_pago,
          tipo_pago, estado_pago = 'Pendiente', num_control_responsable } = req.body;

  if (!monto_total || !tipo_pago || !num_control_responsable)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO pagos (monto_total, monto_abonado, fecha_pago, metodo_pago,
        tipo_pago, estado_pago, num_control_responsable)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [monto_total, monto_abonado, fecha_pago || new Date().toISOString().split('T')[0],
       metodo_pago, tipo_pago, estado_pago, num_control_responsable]
    );

    // Si es mensualidad, crear detalle automáticamente
    if (tipo_pago === 'Mensualidad' && req.body.mes_correspondiente) {
      await pool.query(
        `INSERT INTO mensualidades (id_pago, mes_correspondiente, anio)
         VALUES ($1,$2,$3)`,
        [rows[0].id_pago, req.body.mes_correspondiente,
         req.body.anio || new Date().getFullYear()]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al registrar pago' });
  }
});

// PUT /api/pagos/:id  — actualizar estado, monto_abonado, metodo, etc.
router.put('/:id', auth, allow('admin','instructor'), async (req, res) => {
  const { estado_pago, monto_abonado, metodo_pago, mes_correspondiente, anio } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE pagos
       SET estado_pago = COALESCE($1, estado_pago),
           monto_abonado = COALESCE($2, monto_abonado),
           metodo_pago = COALESCE($3, metodo_pago)
       WHERE id_pago = $4 RETURNING *`,
      [estado_pago || null, monto_abonado != null ? monto_abonado : null,
       metodo_pago || null, req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    // Actualizar mensualidad si se pasaron mes/anio
    if (mes_correspondiente || anio) {
      await client.query(
        `UPDATE mensualidades SET
           mes_correspondiente = COALESCE($1, mes_correspondiente),
           anio = COALESCE($2, anio)
         WHERE id_pago = $3`,
        [mes_correspondiente || null, anio || null, req.params.id]
      );
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar pago' });
  } finally { client.release(); }
});

// DELETE /api/pagos/:id
router.delete('/:id', auth, allow('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM mensualidades WHERE id_pago = $1', [req.params.id]);
    const { rows } = await client.query(
      'DELETE FROM pagos WHERE id_pago = $1 RETURNING id_pago', [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    await client.query('COMMIT');
    res.json({ mensaje: 'Pago eliminado' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar pago' });
  } finally { client.release(); }
});

// PUT /api/pagos/:id/abonar  — registrar un abono parcial
router.put('/:id/abonar', auth, allow('admin'), async (req, res) => {
  const { abono } = req.body;
  if (!abono || abono <= 0) return res.status(400).json({ error: 'Abono inválido' });

  try {
    const { rows } = await pool.query(
      `UPDATE pagos
       SET monto_abonado = monto_abonado + $1,
           estado_pago = CASE WHEN monto_abonado + $1 >= monto_total THEN 'Liquidado' ELSE estado_pago END
       WHERE id_pago = $2 RETURNING *`,
      [abono, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pago no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar abono' });
  }
});

module.exports = router;
