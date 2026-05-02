const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');

// POST /api/auth/login
// Body: { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Faltan credenciales' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM usuarios WHERE username = $1', [username]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const user = rows[0];
    const ok   = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    // Genera token con 8 horas de duración
    const token = jwt.sign(
      {
        id_usuario:  user.id_usuario,
        username:    user.username,
        rol:         user.rol,
        id_responsable: user.num_control_responsable,
        id_instructor:  user.id_instructor
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, rol: user.rol, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
