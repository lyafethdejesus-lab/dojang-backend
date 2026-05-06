const router = require('express').Router();
const pool   = require('../db/pool');
const { auth, allow } = require('../middleware/auth');

// GET /api/alumnos/publico — solo IDs y nombres, sin token (para el login)
router.get('/publico', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT num_control, nombre FROM alumnos ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

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

// POST /api/alumnos/registro-completo
router.post('/registro-completo', auth, allow('admin','instructor'), async (req, res) => {
  const { num_control, nombre, fecha_nacimiento, id_cinta_actual,
          responsable_nombre, responsable_telefono, responsable_direccion,
          username, password } = req.body;

  if (!num_control || !nombre || !fecha_nacimiento || !responsable_nombre || !username || !password)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resp_id = `RESP-${num_control}`;
    await client.query(
      `INSERT INTO responsables (num_control, nombre, telefono, direccion)
       VALUES ($1, $2, $3, $4) ON CONFLICT (num_control) DO NOTHING`,
      [resp_id, responsable_nombre, responsable_telefono || '', responsable_direccion || '']
    );
    const { rows: alumnoRows } = await client.query(
      `INSERT INTO alumnos (num_control, nombre, fecha_nacimiento, id_cinta_actual, num_control_responsable)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [num_control, nombre, fecha_nacimiento, id_cinta_actual || 1, resp_id]
    );
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO usuarios (username, password, rol, num_control_responsable)
       VALUES ($1, $2, 'responsable', $3)`,
      [username, hash, resp_id]
    );
    await client.query('COMMIT');
    res.status(201).json({ alumno: alumnoRows[0], message: 'Alumno registrado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'El ID o usuario ya existe' });
    console.error(err);
    res.status(500).json({ error: 'Error al registrar alumno' });
  } finally {
    client.release();
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

// POST /api/alumnos/registro-completo — crea responsable + alumno + usuario
router.post('/registro-completo', auth, allow('admin','instructor'), async (req, res) => {
  const { num_control, nombre, fecha_nacimiento, id_cinta_actual,
          responsable_nombre, responsable_telefono, responsable_direccion,
          username, password } = req.body;

  if (!num_control || !nombre || !fecha_nacimiento || !responsable_nombre || !username || !password)
    return res.status(400).json({ error: 'Faltan campos obligatorios' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Crear responsable con el mismo num_control del alumno como PK
    const resp_id = `RESP-${num_control}`;
    await client.query(
      `INSERT INTO responsables (num_control, nombre, telefono, direccion)
       VALUES ($1, $2, $3, $4) ON CONFLICT (num_control) DO NOTHING`,
      [resp_id, responsable_nombre, responsable_telefono || '', responsable_direccion || '']
    );

    // 2. Crear alumno
    const { rows: alumnoRows } = await client.query(
      `INSERT INTO alumnos (num_control, nombre, fecha_nacimiento, id_cinta_actual, num_control_responsable)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [num_control, nombre, fecha_nacimiento, id_cinta_actual || 1, resp_id]
    );

    // 3. Crear usuario con bcrypt
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO usuarios (username, password, rol, num_control_responsable)
       VALUES ($1, $2, 'responsable', $3)`,
      [username, hash, resp_id]
    );

    await client.query('COMMIT');
    res.status(201).json({ alumno: alumnoRows[0], message: 'Alumno registrado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'El ID o usuario ya existe' });
    console.error(err);
    res.status(500).json({ error: 'Error al registrar alumno' });
  } finally {
    client.release();
  }
});

module.exports = router;
