// utils/grades.js
// Grade computation based on percentage

const computeGrade = (pct) => {
    const p = parseFloat(pct);
    if (p >= 90) return 'O';
    if (p >= 80) return 'A';
    if (p >= 70) return 'B';
    if (p >= 60) return 'C';
    if (p >= 50) return 'D';
    return 'F';
};

const gradeColor = (grade) => ({
    'O': '#2ecc71', 'A': '#27ae60', 'B': '#3498db',
    'C': '#f39c12', 'D': '#e67e22', 'F': '#e74c3c'
}[grade] || '#999');

module.exports = { computeGrade, gradeColor };
