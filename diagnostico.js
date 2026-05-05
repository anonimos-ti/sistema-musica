require('dotenv').config();
const bcrypt = require('bcryptjs');

const hash = process.env.ADMIN_PASSWORD_HASH;
const pass = 'Sup0rt3T1@2026';

console.log('--- DIAGNÓSTICO DE SEGURANÇA ---');
console.log('1. Verificando .env...');

if (!hash) {
    console.error('ERRO: ADMIN_PASSWORD_HASH não foi encontrado no seu arquivo .env!');
    process.exit(1);
}

console.log('OK: Hash encontrado no .env.');

console.log('2. Verificando criptografia (Bcrypt)...');
bcrypt.compare(pass, hash, (err, res) => {
    if (err) {
        console.error('ERRO NO BCRYPT:', err);
    } else if (res) {
        console.log('SUCESSO: A senha "Sup0rt3T1@2026" encaixa perfeitamente no seu Hash!');
        console.log('Conclusão: O problema não é a senha nem o .env. O erro deve ser na rede ou porta do servidor.');
    } else {
        console.error('ERRO: A senha digitada não bate com o Hash do .env.');
    }
});
