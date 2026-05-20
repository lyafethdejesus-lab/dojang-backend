const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, allow } = require('../middleware/auth');

// GET /api/clases — lista todas las clases con el nombre del instructor
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, i.nombre AS instructor_nombre
      FROM clases c
      LEFT JOIN instructores i ON c.id_instructor = i.id_instructor
      ORDER BY c.id_clase
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener clases' });
  }
});

// POST /api/clases — crear nueva clase
router.post('/', auth, allow('admin'), async (req, res) => {
  const { nombre, dia_semana, hora_inicio, hora_fin, id_instructor } = req.body;
  if (!nombre || !hora_inicio || !hora_fin)
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO clases (nombre, dia_semana, hora_inicio, hora_fin, id_instructor)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nombre, dia_semana || '', hora_inicio, hora_fin, id_instructor || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear clase' });
  }
});

// PUT /api/clases/:id — editar clase
router.put('/:id', auth, allow('admin'), async (req, res) => {
  const { nombre, dia_semana, hora_inicio, hora_fin, id_instructor } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE clases SET
         nombre = COALESCE($1, nombre),
         dia_semana = COALESCE($2, dia_semana),
         hora_inicio = COALESCE($3, hora_inicio),
         hora_fin = COALESCE($4, hora_fin),
         id_instructor = COALESCE($5, id_instructor)
       WHERE id_clase = $6 RETURNING *`,
      [nombre||null, dia_semana||null, hora_inicio||null, hora_fin||null,
       id_instructor||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Clase no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar clase' });
  }
});

// DELETE /api/clases/:id
router.delete('/:id', auth, allow('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM inscripciones WHERE id_clase = $1', [req.params.id]);
    const { rows } = await pool.query(
      'DELETE FROM clases WHERE id_clase = $1 RETURNING id_clase', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Clase no encontrada' });
    res.json({ mensaje: 'Clase eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar clase' });
  }
});

// PUT /api/clases/alumno/:num_control — asignar clase a alumno
router.put('/alumno/:num_control', auth, allow('admin','instructor'), async (req, res) => {
  const { id_clase } = req.body;
  const num_control = req.params.num_control;
  try {
    // Borrar inscripción anterior si existe
    await pool.query('DELETE FROM inscripciones WHERE num_control_alumno = $1', [num_control]);
    if (id_clase) {
      await pool.query(
        'INSERT INTO inscripciones (num_control_alumno, id_clase) VALUES ($1,$2)',
        [num_control, id_clase]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al asignar clase' });
  }
});

module.exports = router;
