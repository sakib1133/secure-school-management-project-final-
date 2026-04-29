// JavaScript will go here

// Helper function for authenticated API requests
async function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    
    if (!token) {
        // If no token, redirect to login
        window.location.href = 'login.html';
        throw new Error('No authentication token found');
    }
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };
    
    try {
        const response = await fetch(url, {
            ...options,
            headers: headers
        });
        
        // If token is invalid or expired, redirect to login
        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('userRole');
            localStorage.removeItem('username');
            window.location.href = 'login.html';
            throw new Error('Authentication failed');
        }
        
        return response;
    } catch (error) {
        if (error.message === 'Authentication failed') {
            throw error;
        }
        console.error('API request error:', error);
        throw error;
    }
}

// Helper function to check if user is authenticated
function isAuthenticated() {
    return !!localStorage.getItem('token');
}

// Helper function to get current user role
function getUserRole() {
    return localStorage.getItem('userRole');
}

// Helper function to logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    localStorage.removeItem('username');
    window.location.href = 'login.html';
}

// DOM Elements
const loginForm = document.getElementById('loginForm');
const studentForm = document.getElementById('studentForm');
const studentsTableBody = document.getElementById('studentsTableBody');
const teacherForm = document.getElementById('teacherForm');
const teachersTableBody = document.getElementById('teachersTableBody');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submitBtn');
const cancelBtn = document.getElementById('cancelBtn');

let isEditMode = false;
let currentId = null;
let currentEntity = ''; // 'student' or 'teacher'

// Login functionality
if (loginForm) {
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                // Redirect based on role
                if (data.role === 'admin') {
                    window.location.href = 'dashboard.html';
                } else if (data.role === 'teacher') {
                    window.location.href = 'teachers.html';
                } else {
                    showError('Invalid user role');
                }
            } else {
                showError(data.message || 'Login failed. Please check your credentials.');
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('An error occurred during login. Please try again.');
        }
    });
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initialize based on current page
    if (window.location.pathname.endsWith('students.html')) {
        currentEntity = 'student';
        fetchStudents();
        studentForm?.addEventListener('submit', handleFormSubmit);
    } else if (window.location.pathname.endsWith('teachers.html')) {
        currentEntity = 'teacher';
        fetchTeachers();
        teacherForm?.addEventListener('submit', handleFormSubmit);
    }
    
    cancelBtn?.addEventListener('click', resetForm);
});

// Fetch all students
async function fetchStudents() {
    try {
        const response = await authenticatedFetch('/students');
        const data = await response.json();
        
        if (data.status === 'success') {
            renderStudents(data.data);
        } else {
            showError('Failed to fetch students');
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Authentication failed') {
            return; // User will be redirected automatically
        }
        showError('Error fetching students');
    }
}

// Render students in the table
function renderStudents(students) {
    if (students.length === 0) {
        studentsTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="no-students">No students found. Add your first student!</td>
            </tr>`;
        return;
    }

    const tableRows = students.map(student => `
        <tr data-id="${student.id}">
            <td>${student.id}</td>
            <td>${student.name}</td>
            <td>${student.age || '-'}</td>
            <td>${student.grade || '-'}</td>
            <td class="actions">
                <button class="btn btn-edit" onclick="editStudent(${student.id}, '${student.name.replace(/'/g, "\\'")}', ${student.age || 'null'}, '${student.grade || ''}')">
                    Edit
                </button>
                <button class="btn btn-delete" onclick="deleteStudent(${student.id}, '${student.name.replace(/'/g, "\\'")}')">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');

    studentsTableBody.innerHTML = tableRows;
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const studentData = {
        name: document.getElementById('name').value.trim(),
        age: document.getElementById('age').value ? parseInt(document.getElementById('age').value) : null,
        grade: document.getElementById('grade').value.trim() || null
    };

    if (!studentData.name) {
        showError('Name is required');
        return;
    }

    try {
        const url = isEditMode ? `/students/${currentStudentId}` : '/students';
        const method = isEditMode ? 'PUT' : 'POST';
        
        const response = await authenticatedFetch(url, {
            method,
            body: JSON.stringify(studentData)
        });

        const data = await response.json();
        
        if (response.ok) {
            showSuccess(isEditMode ? 'Student updated successfully' : 'Student added successfully');
            resetForm();
            fetchStudents();
        } else {
            throw new Error(data.message || 'Something went wrong');
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Authentication failed') {
            return; // User will be redirected automatically
        }
        showError(error.message || 'Error saving student');
    }
}

// Edit student
function editStudent(id, name, age, grade) {
    isEditMode = true;
    currentStudentId = id;
    
    document.getElementById('studentId').value = id;
    document.getElementById('name').value = name;
    document.getElementById('age').value = age || '';
    document.getElementById('grade').value = grade || '';
    
    formTitle.textContent = 'Edit Student';
    submitBtn.textContent = 'Update Student';
    cancelBtn.style.display = 'inline-block';
    
    // Scroll to form
    document.querySelector('.student-form').scrollIntoView({ behavior: 'smooth' });
}

// Delete student
async function deleteStudent(id, name) {
    if (!confirm(`Are you sure you want to delete ${name}?`)) {
        return;
    }

    try {
        const response = await authenticatedFetch(`/students/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        
        if (response.ok) {
            showSuccess('Student deleted successfully');
            fetchStudents();
        } else {
            throw new Error(data.message || 'Failed to delete student');
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Authentication failed') {
            return; // User will be redirected automatically
        }
        showError(error.message || 'Error deleting student');
    }
}

// Reset form
function resetForm() {
    studentForm.reset();
    isEditMode = false;
    currentStudentId = null;
    
    formTitle.textContent = 'Add New Student';
    submitBtn.textContent = 'Add Student';
    cancelBtn.style.display = 'none';
    
    // Clear any error messages
    const errorElements = document.querySelectorAll('.error-message');
    errorElements.forEach(el => el.remove());
}

// Show success message
function showSuccess(message) {
    // Remove any existing messages
    const existingMessages = document.querySelectorAll('.success-message');
    existingMessages.forEach(el => el.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'success-message';
    messageDiv.style.color = 'green';
    messageDiv.style.marginTop = '1rem';
    messageDiv.textContent = message;
    
    // Append to the current form
    const form = currentEntity === 'student' ? studentForm : teacherForm;
    form?.insertBefore(messageDiv, form.firstChild);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// Show error message
function showError(message) {
    // Remove any existing messages
    const existingMessages = document.querySelectorAll('.error-message');
    existingMessages.forEach(el => el.remove());
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.color = 'red';
    errorDiv.style.marginTop = '1rem';
    errorDiv.style.marginBottom = '1rem';
    errorDiv.textContent = message;
    
    // Append to the current form
    const form = currentEntity === 'student' ? studentForm : teacherForm;
    form?.insertBefore(errorDiv, form.firstChild);
    
    // Scroll to show the error message
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Teacher Management
async function fetchTeachers() {
    try {
        const response = await authenticatedFetch('/teachers');
        const data = await response.json();
        
        if (data.status === 'success') {
            renderTeachers(data.data);
        } else {
            showError('Failed to fetch teachers');
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Authentication failed') {
            return; // User will be redirected automatically
        }
        showError('Error fetching teachers');
    }
}

function renderTeachers(teachers) {
    if (!teachersTableBody) return;
    
    if (teachers.length === 0) {
        teachersTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="no-teachers">No teachers found. Add your first teacher!</td>
            </tr>`;
        return;
    }

    const tableRows = teachers.map(teacher => `
        <tr data-id="${teacher.id}">
            <td>${teacher.id}</td>
            <td>${teacher.name}</td>
            <td>${teacher.subject || '-'}</td>
            <td>${teacher.experience ? teacher.experience + ' years' : '-'}</td>
            <td class="actions">
                <button class="btn btn-edit" onclick="editTeacher(${teacher.id}, '${teacher.name.replace(/'/g, "\\'")}', '${teacher.subject ? teacher.subject.replace(/'/g, "\\'") : ''}', ${teacher.experience || 'null'})">
                    Edit
                </button>
                <button class="btn btn-delete" onclick="deleteTeacher(${teacher.id}, '${teacher.name.replace(/'/g, "\\'")}')">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');

    teachersTableBody.innerHTML = tableRows;
}

// Form handling
async function handleFormSubmit(e) {
    e.preventDefault();
    
    if (currentEntity === 'student') {
        await handleStudentForm();
    } else if (currentEntity === 'teacher') {
        await handleTeacherForm();
    }
}

async function handleStudentForm() {
    const studentData = {
        name: document.getElementById('name').value.trim(),
        age: document.getElementById('age').value ? parseInt(document.getElementById('age').value) : null,
        grade: document.getElementById('grade').value.trim() || null
    };

    if (!studentData.name) {
        showError('Name is required');
        return;
    }

    try {
        const url = isEditMode ? `/students/${currentId}` : '/students';
        const method = isEditMode ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(studentData)
        });

        const data = await response.json();
        
        if (response.ok) {
            showSuccess(isEditMode ? 'Student updated successfully' : 'Student added successfully');
            resetForm();
            fetchStudents();
        } else {
            throw new Error(data.message || 'Something went wrong');
        }
    } catch (error) {
        console.error('Error:', error);
        showError(error.message || 'Error saving student');
    }
}

async function handleTeacherForm() {
    const teacherData = {
        name: document.getElementById('name').value.trim(),
        subject: document.getElementById('subject').value.trim() || null,
        experience: document.getElementById('experience').value ? 
            parseInt(document.getElementById('experience').value) : null
    };

    if (!teacherData.name) {
        showError('Name is required');
        return;
    }

    try {
        const url = isEditMode ? `/teachers/${currentId}` : '/teachers';
        const method = isEditMode ? 'PUT' : 'POST';
        
        const response = await authenticatedFetch(url, {
            method,
            body: JSON.stringify(teacherData)
        });

        const data = await response.json();
        
        if (response.ok) {
            showSuccess(isEditMode ? 'Teacher updated successfully' : 'Teacher added successfully');
            resetForm();
            fetchTeachers();
        } else {
            throw new Error(data.message || 'Something went wrong');
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Authentication failed') {
            return; // User will be redirected automatically
        }
        showError(error.message || 'Error saving teacher');
    }
}

// Edit teacher
function editTeacher(id, name, subject, experience) {
    isEditMode = true;
    currentId = id;
    currentEntity = 'teacher';
    
    document.getElementById('teacherId').value = id;
    document.getElementById('name').value = name;
    document.getElementById('subject').value = subject || '';
    document.getElementById('experience').value = experience || '';
    
    formTitle.textContent = 'Edit Teacher';
    submitBtn.textContent = 'Update Teacher';
    cancelBtn.style.display = 'inline-block';
    
    // Scroll to form
    document.querySelector('.teacher-form').scrollIntoView({ behavior: 'smooth' });
}

// Delete teacher
async function deleteTeacher(id, name) {
    if (!confirm(`Are you sure you want to delete ${name}?`)) {
        return;
    }

    try {
        const response = await authenticatedFetch(`/teachers/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        
        if (response.ok) {
            showSuccess('Teacher deleted successfully');
            fetchTeachers();
        } else {
            throw new Error(data.message || 'Failed to delete teacher');
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Authentication failed') {
            return; // User will be redirected automatically
        }
        showError(error.message || 'Error deleting teacher');
    }
}

// Reset form
function resetForm() {
    const form = currentEntity === 'student' ? studentForm : teacherForm;
    form?.reset();
    isEditMode = false;
    currentId = null;
    
    if (formTitle) {
        formTitle.textContent = currentEntity === 'student' ? 'Add New Student' : 'Add New Teacher';
    }
    if (submitBtn) {
        submitBtn.textContent = currentEntity === 'student' ? 'Add Student' : 'Add Teacher';
    }
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
    
    // Clear any error messages
    const errorElements = document.querySelectorAll('.error-message, .success-message');
    errorElements.forEach(el => el.remove());
}

// Make functions available globally
window.editStudent = editStudent;
window.deleteStudent = deleteStudent;
window.editTeacher = editTeacher;
window.deleteTeacher = deleteTeacher;
