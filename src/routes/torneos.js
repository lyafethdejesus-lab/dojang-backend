const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, allow } = require('../middleware/auth');

// GET /api/torneos
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM torneos ORDER BY fecha DESC');
    res.json(rows);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener torneos' });
  }
});

// POST /api/torneos
router.post('/', auth, allow('admin','instructor'), async (req, res) => {
  const { nombre_torneo, nombre, sede, fecha, categoria } = req.body;
  const nombreFinal = nombre_torneo || nombre;
  if (!nombreFinal || !fecha)
    return res.status(400).json({ error: 'Nombre y fecha son obligatorios' });
  try {
    // Intentar con nombre_torneo primero, si falla intentar con nombre
    let rows;
    try {
      const r = await pool.query(
        `INSERT INTO torneos (nombre_torneo, sede, fecha) VALUES ($1,$2,$3) RETURNING *`,
        [nombreFinal, sede||null, fecha]
      );
      rows = r.rows;
    } catch(e) {
      // Si la columna se llama "nombre"
      const r = await pool.query(
        `INSERT INTO torneos (nombre, sede, fecha) VALUES ($1,$2,$3) RETURNING *`,
        [nombreFinal, sede||null, fecha]
      );
      rows = r.rows;
    }
    res.status(201).json(rows[0]);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear torneo' });
  }
});

// PUT /api/torneos/:id
router.put('/:id', auth, allow('admin','instructor'), async (req, res) => {
  const { nombre_torneo, nombre, sede, fecha } = req.body;
  const nombreFinal = nombre_torneo || nombre;
  try {
    let rows;
    try {
      const r = await pool.query(
        `UPDATE torneos SET nombre_torneo=$1, sede=$2, fecha=$3 WHERE id_torneo=$4 RETURNING *`,
        [nombreFinal, sede||null, fecha, req.params.id]
      );
      rows = r.rows;
    } catch(e) {
      const r = await pool.query(
        `UPDATE torneos SET nombre=$1, sede=$2, fecha=$3 WHERE id_torneo=$4 RETURNING *`,
        [nombreFinal, sede||null, fecha, req.params.id]
      );
      rows = r.rows;
    }
    if (!rows.length) return res.status(404).json({ error: 'Torneo no encontrado' });
    res.json(rows[0]);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar torneo' });
  }
});

// DELETE /api/torneos/:id
router.delete('/:id', auth, allow('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM torneos WHERE id_torneo=$1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Torneo no encontrado' });
    res.json({ mensaje: 'Torneo eliminado' });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar torneo' });
  }
});

module.exports = router;
