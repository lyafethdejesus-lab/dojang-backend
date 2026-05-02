const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, allow } = require('../middleware/auth');

// GET /api/alumnos  — admin e instructores ven todos; responsable solo los suyos
router.get('/', auth, async (req, res) => {
  try {
    let query, params = [];

    if (req.user.rol === 'responsable') {
      query = `
        SELECT a.*, c.color AS cinta_color, c.nombre_grado
        FROM alumnos a
        JOIN cintas c ON c.id_cinta = a.id_cinta_actual
        WHERE a.num_control_responsable = $1
        ORDER BY a.nombre`;
      params = [req.user.id_responsable];
    } else {
      query = `
        SELECT a.*, c.color AS cinta_color, c.nombre_grado,
               r.nombre AS responsable_nombre
        FROM alumnos a
        JOIN cintas c ON c.id_cinta = a.id_cinta_actual
        JOIN responsables r ON r.num_control = a.num_control_responsable
        ORDER BY a.nombre`;
    }

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener alumnos' });
  }
});

// GET /api/alumnos/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, c.color AS cinta_color, c.nombre_grado,
              r.nombre AS responsable_nombre, r.telefono AS responsable_tel
       FROM alumnos a
       JOIN cintas c ON c.id_cinta = a.id_cinta_actual
       JOIN responsables r ON r.num_control = a.num_control_responsable
       WHERE a.num_control = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Alumno no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/alumnos  — solo admin e instructor
router.post('/', auth, allow('admin','instructor'), async (req, res) => {
  const { num_control, nombre, fecha_nacimiento, id_cinta_actual, num_control_responsable } = req.body;
  if (!num_control || !nombre || !fecha_nacimiento || !id_cinta_actual || !num_control_responsable)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO alumnos (num_control, nombre, fecha_nacimiento, id_cinta_actual, num_control_responsable)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [num_control, nombre, fecha_nacimiento, id_cinta_actual, num_control_responsable]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Num. de control ya existe' });
    res.status(500).json({ error: 'Error al registrar alumno' });
  }
});

// PUT /api/alumnos/:id  — actualizar cinta o datos
router.put('/:id', auth, allow('admin','instructor'), async (req, res) => {
  const { nombre, fecha_nacimiento, id_cinta_actual, num_control_responsable } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE alumnos SET nombre=$1, fecha_nacimiento=$2, id_cinta_actual=$3,
        num_control_responsable=$4
       WHERE num_control=$5 RETURNING *`,
      [nombre, fecha_nacimiento, id_cinta_actual, num_control_responsable, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Alumno no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar alumno' });
  }
});

// DELETE /api/alumnos/:id  — solo admin
router.delete('/:id', auth, allow('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM alumnos WHERE num_control=$1', [req.params.id]);
    res.json({ mensaje: 'Alumno eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar alumno' });
  }
});

module.exports = router;
