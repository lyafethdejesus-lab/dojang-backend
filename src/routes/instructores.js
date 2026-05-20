const router = require('express').Router();
const bcrypt = require('bcrypt');
const pool   = require('../db/pool');
const { auth, allow } = require('../middleware/auth');

// GET /api/instructores
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM instructores ORDER BY id_instructor'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener instructores' });
  }
});

// GET /api/instructores/mi-perfil — perfil del instructor logueado
router.get('/mi-perfil', auth, async (req, res) => {
  const id_instructor = req.user.id_instructor;
  if (!id_instructor)
    return res.status(404).json({ error: 'Sin instructor vinculado' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM instructores WHERE id_instructor = $1', [id_instructor]
    );
    if (!rows.length) return res.status(404).json({ error: 'Instructor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener perfil' });
  }
});

// PUT /api/instructores/mi-perfil — actualizar perfil propio
router.put('/mi-perfil', auth, async (req, res) => {
  const id_instructor = req.user.id_instructor;
  if (!id_instructor) return res.status(400).json({ error: 'Sin instructor vinculado' });
  const { nombre, cargo, grado_cinta, email, telefono } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE instructores SET
         nombre = COALESCE($1, nombre),
         cargo  = COALESCE($2, cargo),
         grado_cinta = COALESCE($3, grado_cinta),
         email  = COALESCE($4, email),
         telefono = COALESCE($5, telefono)
       WHERE id_instructor = $6 RETURNING *`,
      [nombre||null, cargo||null, grado_cinta||null,
       email||null, telefono||null, id_instructor]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// POST /api/instructores — dar de alta nuevo instructor + usuario
router.post('/', auth, allow('admin'), async (req, res) => {
  const { nombre, cargo, grado_cinta, email, telefono, username, password } = req.body;
  if (!nombre || !username || !password)
    return res.status(400).json({ error: 'Faltan nombre, usuario o contraseña' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: instrRows } = await client.query(
      `INSERT INTO instructores (nombre, cargo, grado_cinta, email, telefono)
       VALUES ($1,$2,$3,$4,$5) RETURNING id_instructor`,
      [nombre, cargo||'Instructor', grado_cinta||'Negro',
       email||null, telefono||null]
    );
    const id_instructor = instrRows[0].id_instructor;
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO usuarios (username, password, rol, id_instructor)
       VALUES ($1,$2,'instructor',$3)`,
      [username, hash, id_instructor]
    );
    await client.query('COMMIT');
    res.status(201).json({ ok: true, id_instructor });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505')
      return res.status(409).json({ error: 'El usuario ya existe' });
    res.status(500).json({ error: 'Error al registrar instructor' });
  } finally { client.release(); }
});

// PUT /api/instructores/:id — editar instructor
router.put('/:id', auth, allow('admin'), async (req, res) => {
  const { nombre, cargo, grado_cinta, email, telefono } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE instructores SET
         nombre = COALESCE($1, nombre),
         cargo  = COALESCE($2, cargo),
         grado_cinta = COALESCE($3, grado_cinta),
         email  = COALESCE($4, email),
         telefono = COALESCE($5, telefono)
       WHERE id_instructor = $6 RETURNING *`,
      [nombre||null, cargo||null, grado_cinta||null,
       email||null, telefono||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Instructor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar instructor' });
  }
});

// DELETE /api/instructores/:id
router.delete('/:id', auth, allow('admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Desasignar clases antes de borrar
    await client.query(
      'UPDATE clases SET id_instructor = NULL WHERE id_instructor = $1', [req.params.id]
    );
    // Borrar usuario vinculado
    await client.query(
      'DELETE FROM usuarios WHERE id_instructor = $1', [req.params.id]
    );
    const { rows } = await client.query(
      'DELETE FROM instructores WHERE id_instructor = $1 RETURNING id_instructor', [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Instructor no encontrado' });
    }
    await client.query('COMMIT');
    res.json({ mensaje: 'Instructor eliminado' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar instructor' });
  } finally { client.release(); }
});

module.exports = router;
