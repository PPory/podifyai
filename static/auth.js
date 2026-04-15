// static/auth.js - 处理用户认证的前端逻辑（支持验证码登录）

document.addEventListener('DOMContentLoaded', () => {
    // 检查后端配置并初始化UI
    checkBackendConfigAndInitUI();

    // 表单元素
    const otpLoginForm = document.getElementById('otp-login-form');
    const otpRegisterForm = document.getElementById('otp-register-form');
    const passwordLoginForm = document.getElementById('password-login-form');
    const legacyLoginForm = document.getElementById('legacy-login-form');
    const legacyRegisterForm = document.getElementById('legacy-register-form');
    
    // 切换方式的元素
    const toggleLoginMethod = document.getElementById('toggle-login-method');
    const toggleRegisterMethod = document.getElementById('toggle-register-method');
    
    // 验证码按钮
    const getLoginCodeBtn = document.getElementById('get-login-code-btn');
    const getRegisterCodeBtn = document.getElementById('get-register-code-btn');
    
    // Tab 切换相关元素
    const loginTabs = document.getElementById('login-tabs');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const passwordTabBtn = document.getElementById('password-tab-btn');
    
    // 密码可见性切换
    const togglePasswordBtn = document.getElementById('toggle-password-visibility');
    const passwordInput = document.getElementById('password-password');

    // 统一的错误信息显示函数
    const showErrorMessage = (message) => {
        const errorElement = document.getElementById('error-message');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = message ? 'block' : 'none';
        }
    };

    // 成功信息显示函数
    const showSuccessMessage = (message) => {
        const errorElement = document.getElementById('error-message');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
            errorElement.style.color = '#4CAF50';
            
            // 3秒后清除成功信息
            setTimeout(() => {
                errorElement.style.color = '';
                errorElement.style.display = 'none';
            }, 3000);
        }
    };

    // 验证邮箱格式
    const validateEmail = (email) => {
        const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return pattern.test(email);
    };

    // 验证手机号格式（中国大陆）
    const validatePhone = (phone) => {
        const pattern = /^1[3-9]\d{9}$/;
        return pattern.test(phone);
    };

    // 判断输入是邮箱还是手机号
    const getTargetChannel = (target) => {
        if (validateEmail(target)) {
            return 'email';
        } else if (validatePhone(target)) {
            return 'phone';
        }
        return null;
    };

    // Tab 切换功能
    if (loginTabs) {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');
                
                // 更新按钮状态
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // 更新内容显示
                tabContents.forEach(content => {
                    content.classList.remove('active');
                    if (content.id === `${targetTab}-login-section`) {
                        content.classList.add('active');
                    }
                });
            });
        });
    }
    
    // 密码可见性切换
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            togglePasswordBtn.textContent = type === 'password' ? '👁' : '🙈';
        });
    }
    
    // 验证码按钮倒计时功能
    const startCountdown = (button, seconds = 60) => {
        let countdown = seconds;
        const originalText = button.textContent;
        
        button.disabled = true;
        button.textContent = `${countdown}秒后重新获取`;
        
        const timer = setInterval(() => {
            countdown--;
            button.textContent = `${countdown}秒后重新获取`;
            
            if (countdown <= 0) {
                clearInterval(timer);
                button.disabled = false;
                button.textContent = originalText;
            }
        }, 1000);
    };

    // 密码登录处理
    if (passwordLoginForm) {
        passwordLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('password-email').value.trim();
            const password = document.getElementById('password-password').value;
            
            if (!email || !password) {
                showErrorMessage('请填写邮箱和密码');
                return;
            }
            
            try {
                const response = await fetch('/auth/login-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email, password })
                });
                
                const data = await response.json();
                
                if (response.ok && data.ok) {
                    showSuccessMessage('登录成功，正在跳转...');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1000);
                } else {
                    const errorMsg = data.error || '登录失败';
                    if (response.status === 401) {
                        showErrorMessage('邮箱或密码不正确');
                    } else {
                        showErrorMessage(errorMsg);
                    }
                }
            } catch (error) {
                console.error('密码登录请求失败:', error);
                showErrorMessage('网络错误，请稍后重试');
            }
        });
    }
    
    // 忘记密码功能 - 强模态实现
    (function () {
        const modal = document.getElementById('forgot-password-modal');
        if (!modal) return;

        // 约定：打开按钮需要有 id="forgot-password-btn"
        const openBtn = document.getElementById('forgot-password-btn');
        const closeBtn = modal.querySelector('.close, #close-forgot-modal');
        const content = modal.querySelector('.modal-content');
        const sendForgotCodeBtn = document.getElementById('send-forgot-code-btn');
        const resetPasswordBtn = document.getElementById('reset-password-btn');

        const open = (e) => {
            if (e) e.preventDefault();
            modal.setAttribute('aria-hidden', 'false'); // 触发 CSS 显示
            // 重置弹窗状态
            document.getElementById('forgot-step1').style.display = 'block';
            document.getElementById('forgot-step2').style.display = 'none';
            document.getElementById('forgot-email').value = '';
            document.getElementById('forgot-code').value = '';
            document.getElementById('forgot-new-password').value = '';
            document.getElementById('forgot-confirm-password').value = '';
        };
        const close = (e) => {
            if (e) e.preventDefault();
            modal.setAttribute('aria-hidden', 'true');
        };

        openBtn && openBtn.addEventListener('click', open);
        closeBtn && closeBtn.addEventListener('click', close);

        // 关键：禁止点击遮罩关闭
        modal.addEventListener('click', (e) => {
            // 点击到遮罩（modal 自身），不做任何事
            if (e.target === modal) {
                e.stopPropagation();
                // 不 close()
            }
        });
        // 点击内容区域，阻止冒泡到遮罩
        content && content.addEventListener('click', (e) => e.stopPropagation());

        // 可选：屏蔽 ESC 关闭（如无 ESC 逻辑，可省略）
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') e.preventDefault();
        });

        // 发送忘记密码验证码
        if (sendForgotCodeBtn) {
            sendForgotCodeBtn.addEventListener('click', async () => {
                const email = document.getElementById('forgot-email').value.trim();
                
                if (!email) {
                    showErrorMessage('请输入邮箱地址');
                    return;
                }
                
                try {
                    const response = await fetch('/auth/password/forgot/request', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ email })
                    });
                    
                    const data = await response.json();
                    
                    if (response.ok && data.ok) {
                        showSuccessMessage('验证码已发送，请查收邮件');
                        // 切换到步骤2
                        document.getElementById('forgot-step1').style.display = 'none';
                        document.getElementById('forgot-step2').style.display = 'block';
                    } else {
                        showErrorMessage(data.error || '发送失败');
                    }
                } catch (error) {
                    console.error('发送忘记密码验证码失败:', error);
                    showErrorMessage('网络错误，请稍后重试');
                }
            });
        }
        
        // 重置密码
        if (resetPasswordBtn) {
            resetPasswordBtn.addEventListener('click', async () => {
                const email = document.getElementById('forgot-email').value.trim();
                const code = document.getElementById('forgot-code').value.trim();
                const newPassword = document.getElementById('forgot-new-password').value;
                const confirmPassword = document.getElementById('forgot-confirm-password').value;
                
                if (!email || !code || !newPassword || !confirmPassword) {
                    showErrorMessage('请填写完整信息');
                    return;
                }
                
                if (newPassword !== confirmPassword) {
                    showErrorMessage('两次输入的密码不一致');
                    return;
                }
                
                if (newPassword.length < 8) {
                    showErrorMessage('密码长度至少8位');
                    return;
                }
                
                try {
                    const response = await fetch('/auth/password/forgot/confirm', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            email,
                            otp_code: code,
                            new_password: newPassword,
                            new_password_confirm: confirmPassword
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (response.ok && data.ok) {
                        showSuccessMessage('密码重置成功，请使用新密码登录');
                        close(); // 使用 close 函数关闭弹窗
                    } else {
                        showErrorMessage(data.error || '密码重置失败');
                    }
                } catch (error) {
                    console.error('重置密码失败:', error);
                    showErrorMessage('网络错误，请稍后重试');
                }
            });
        }
    })();
    
    // 获取验证码通用函数
    const requestOtpCode = async (target, purpose, button) => {
        try {
            showErrorMessage('');
            
            if (!target.trim()) {
                showErrorMessage('请输入邮箱或手机号');
                return;
            }
            
            const channel = getTargetChannel(target.trim());
            if (!channel) {
                showErrorMessage('请输入有效的邮箱或手机号');
                return;
            }
            
            const response = await fetch('/auth/request-code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    target: target.trim(),
                    channel: channel,
                    purpose: purpose
                }),
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `HTTP error! status: ${response.status}`);
            }
            
            // 发送成功，开始倒计时
            showSuccessMessage('验证码已发送，请查收');
            startCountdown(button);
            
        } catch (error) {
            console.error('获取验证码失败:', error);
            showErrorMessage(error.message);
        }
    };

    // 切换登录方式
    if (toggleLoginMethod) {
        toggleLoginMethod.addEventListener('click', (e) => {
            e.preventDefault();
            const otpSection = document.getElementById('otp-login-section');
            const legacySection = document.getElementById('legacy-login-section');
            
            if (otpSection.style.display === 'none') {
                // 切换到验证码登录
                otpSection.style.display = 'block';
                legacySection.style.display = 'none';
                toggleLoginMethod.textContent = '使用用户名密码登录';
            } else {
                // 切换到传统登录
                otpSection.style.display = 'none';
                legacySection.style.display = 'block';
                toggleLoginMethod.textContent = '使用验证码登录';
            }
        });
    }

    // 切换注册方式
    if (toggleRegisterMethod) {
        toggleRegisterMethod.addEventListener('click', (e) => {
            e.preventDefault();
            const otpSection = document.getElementById('otp-register-section');
            const legacySection = document.getElementById('legacy-register-section');
            
            if (otpSection.style.display === 'none') {
                // 切换到验证码注册
                otpSection.style.display = 'block';
                legacySection.style.display = 'none';
                toggleRegisterMethod.textContent = '使用用户名密码注册';
            } else {
                // 切换到传统注册
                otpSection.style.display = 'none';
                legacySection.style.display = 'block';
                toggleRegisterMethod.textContent = '使用验证码注册';
            }
        });
    }

    // 获取登录验证码
    if (getLoginCodeBtn) {
        getLoginCodeBtn.addEventListener('click', () => {
            const target = document.getElementById('login-target').value;
            requestOtpCode(target, 'login', getLoginCodeBtn);
        });
    }

    // 获取注册验证码
    if (getRegisterCodeBtn) {
        getRegisterCodeBtn.addEventListener('click', () => {
            const target = document.getElementById('register-target').value;
            requestOtpCode(target, 'register', getRegisterCodeBtn);
        });
    }

    // 验证码登录表单处理
    if (otpLoginForm) {
        otpLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showErrorMessage('');

            const target = document.getElementById('login-target').value.trim();
            const code = document.getElementById('login-code').value.trim();

            if (!target || !code) {
                showErrorMessage('请填写完整信息');
                return;
            }

            const channel = getTargetChannel(target);
            if (!channel) {
                showErrorMessage('请输入有效的邮箱或手机号');
                return;
            }

            try {
                const response = await fetch('/auth/verify-code', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        target: target,
                        channel: channel,
                        code: code,
                        purpose: 'login'
                    }),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `HTTP error! status: ${response.status}`);
                }

                // 登录成功，跳转到主页
                showSuccessMessage('登录成功！');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1000);

            } catch (error) {
                console.error('验证码登录失败:', error);
                showErrorMessage(error.message);
            }
        });
    }

    // 验证码注册表单处理
    if (otpRegisterForm) {
        otpRegisterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showErrorMessage('');

            const target = document.getElementById('register-target').value.trim();
            const code = document.getElementById('register-code').value.trim();
            const password = document.getElementById('register-password').value;
            const passwordConfirm = document.getElementById('register-password-confirm').value;

            if (!target || !code) {
                showErrorMessage('请填写完整信息');
                return;
            }

            // 密码验证逻辑
            if (password || passwordConfirm) {
                if (!password || !passwordConfirm) {
                    showErrorMessage('请填写密码和确认密码');
                    return;
                }
                
                if (password !== passwordConfirm) {
                    showErrorMessage('两次输入的密码不一致');
                    return;
                }
                
                if (password.length < 8) {
                    showErrorMessage('密码长度至少8位');
                    return;
                }
            }

            const channel = getTargetChannel(target);
            if (!channel) {
                showErrorMessage('请输入有效的邮箱或手机号');
                return;
            }

            try {
                const requestBody = {
                    target: target,
                    channel: channel,
                    code: code,
                    purpose: 'register'
                };

                // 如果设置了密码，则包含在请求中
                if (password) {
                    requestBody.password = password;
                    requestBody.password_confirm = passwordConfirm;
                }

                const response = await fetch('/auth/verify-code', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `HTTP error! status: ${response.status}`);
                }

                // 注册成功，跳转到主页
                showSuccessMessage('注册成功！');
                setTimeout(() => {
                    window.location.href = '/';
                }, 1000);

            } catch (error) {
                console.error('验证码注册失败:', error);
                showErrorMessage(error.message);
            }
        });
    }

    // 传统注册表单处理（兼容）
    if (legacyRegisterForm) {
        legacyRegisterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showErrorMessage('');

            const username = document.getElementById('legacy-username').value;
            const password = document.getElementById('legacy-password').value;
            const email = document.getElementById('legacy-email').value;
            const phone = document.getElementById('legacy-phone').value;

            // 前端基本验证
            if (username.length < 3) {
                showErrorMessage('用户名至少需要3个字符');
                return;
            }
            if (password.length < 6) {
                showErrorMessage('密码至少需要6个字符');
                return;
            }

            try {
                const requestBody = { username, password };
                if (email) requestBody.email = email;
                if (phone) requestBody.phone = phone;

                const response = await fetch('/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `HTTP error! status: ${response.status}`);
                }

                // 处理注册响应
                if (data.need_verification) {
                    alert(`注册成功！请验证您的${data.contact_method === 'email' ? '邮箱' : '手机号'}后登录。`);
                    window.location.href = '/login';
                } else if (data.need_bind_contact) {
                    alert('注册成功！建议绑定邮箱或手机号以提升安全性。');
                    window.location.href = '/login';
                } else {
                    alert('注册成功！');
                window.location.href = '/login';
                }

            } catch (error) {
                console.error('注册失败:', error);
                showErrorMessage(error.message);
            }
        });
    }

    // 传统登录表单处理（兼容）
    if (legacyLoginForm) {
        legacyLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showErrorMessage('');

            const username = document.getElementById('legacy-username').value;
            const password = document.getElementById('legacy-password').value;

            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || `HTTP error! status: ${response.status}`);
                }

                // 处理登录响应提示
                if (data.need_bind_contact) {
                    showSuccessMessage(data.suggestion);
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 2000);
                } else if (data.need_verification) {
                    showSuccessMessage(data.suggestion);
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 2000);
                } else {
                    showSuccessMessage('登录成功！');
                    setTimeout(() => {
                window.location.href = '/';
                    }, 1000);
                }

            } catch (error) {
                console.error('登录失败:', error);
                showErrorMessage(error.message);
            }
        });
    }

    // 检查后端配置并初始化UI
    async function checkBackendConfigAndInitUI() {
        try {
            // 检查用户状态接口，获取后端配置
            const statusResponse = await fetch('/api/user/status');
            if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                
                // 根据后端配置控制密码登录 Tab 的显示
                const passwordTabBtn = document.getElementById('password-tab-btn');
                if (passwordTabBtn) {
                    if (statusData.allow_password_login === true) {
                        passwordTabBtn.style.display = 'inline-block';
                    } else {
                        passwordTabBtn.style.display = 'none';
                    }
                }
            }
            
            // 尝试传统登录检查是否被禁用
            const testResponse = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: '__test__', password: '__test__' })
            });

            const legacyToggle = document.getElementById('legacy-login-toggle');
            
            if (testResponse.status === 403) {
                // 传统登录被禁用，隐藏切换选项
                if (legacyToggle) {
                    legacyToggle.style.display = 'none';
                }
            } else {
                // 传统登录可用，显示切换选项
                if (legacyToggle) {
                    legacyToggle.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('检查后端配置失败:', error);
            // 默认显示切换选项
            const legacyToggle = document.getElementById('legacy-login-toggle');
            if (legacyToggle) {
                legacyToggle.style.display = 'block';
            }
        }
    }
});
