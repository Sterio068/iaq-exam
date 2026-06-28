// 室內空品題庫備考系統 - 主程式

// 系統設定常數
const CONFIG = {
    EXAM_TIME_MINUTES: 90,
    EXAM_QUESTION_COUNT: 50,
    PASSING_THRESHOLD: 70,
    TIMED_PRACTICE_COUNT: 20,
    TIMER_INTERVAL_MS: 1000,
    MAX_EXAM_HISTORY: 10,
    ANIMATION_DELAY_MS: 300,
    ID_PREFIX_LENGTH: 4,
    TOAST_DURATION_MS: 2600,
    TOAST_REMOVE_FALLBACK_MS: 600,
    TOAST_MAX_VISIBLE: 3,
    IMAGE_ALT_MAX_LENGTH: 60
};

// 清除答案文字（移除標點符號）
const cleanAnswer = (str) => str.replace(/[。．.、，、,（）()「」『』【】〈〉《》\[\]{}《》:：;；?!！?？]/g, ' ').replace(/\s+/g, ' ').trim();

// 關鍵字比對答案檢查
const checkKeywordAnswer = (userAnswer, correctAnswer) => {
    const stdAnswer = cleanAnswer(correctAnswer || '');
    const userAns = cleanAnswer(userAnswer);
    const keywords = stdAnswer.split(' ').filter(k => k.length > 0);
    return keywords.length > 0 && keywords.every(keyword => 
        userAns.toLowerCase().includes(keyword.toLowerCase())
    );
};

const App = {
    currentSection: 'menu',
    practiceMode: null,
    practiceQuestions: [],
    practiceIndex: 0,
    examQuestions: [],
    examAnswers: {},
    examCurrentIndex: 0,
    examStartTime: null,
    examTimerInterval: null,
    selectedChoice: null,
    practiceCorrect: 0,
    practiceAttempted: 0,
    practiceStartTime: null,
    practiceTimerInterval: null,
    practiceTimeLeft: 0,
    examFlagged: null,

    // GA4 事件追蹤（gtag 未就緒時靜默忽略）
    track(name, params) {
        if (typeof window.gtag !== 'function') return;
        window.gtag('event', name, params || {});
    },

    // Core Web Vitals RUM：以 PerformanceObserver 量測 LCP/CLS/INP
    rateVital(name, value) {
        const t = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500] }[name];
        if (!t) return 'unknown';
        return value <= t[0] ? 'good' : value <= t[1] ? 'needs-improvement' : 'poor';
    },

    sendVital(name, value) {
        this.track('web_vital', {
            name: name,
            value: Math.round(value * 1000) / 1000,
            rating: this.rateVital(name, value),
            path: window.location.pathname || '/'
        });
    },

    initWebVitals() {
        if (typeof PerformanceObserver !== 'function') return;
        try {
            let lcp = 0;
            new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const last = entries[entries.length - 1];
                if (last) lcp = last.startTime;
            }).observe({ type: 'largest-contentful-paint', buffered: true });

            let cls = 0;
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) cls += entry.value;
                }
            }).observe({ type: 'layout-shift', buffered: true });

            let inp = 0;
            try {
                new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.duration > inp) inp = entry.duration;
                    }
                }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
            } catch (e) { /* event timing unsupported */ }

            const flush = () => {
                if (document.visibilityState !== 'hidden') return;
                if (lcp > 0) { this.sendVital('LCP', lcp); lcp = 0; }
                this.sendVital('CLS', cls);
                if (inp > 0) { this.sendVital('INP', inp); inp = 0; }
            };
            document.addEventListener('visibilitychange', flush);
            window.addEventListener('pagehide', flush, { once: true });
        } catch (e) {
            /* observer unsupported, skip RUM */
        }
    },

    // XSS 防護：將使用者輸入的文字進行 HTML 轉義
    sanitize(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // 安全設定 innerHTML（使用 textContent 避免 XSS）
    safeSetHTML(element, html) {
        element.innerHTML = html;
    },

    // 非阻斷提示（取代 alert）
    showToast(message, type = 'info') {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            container.setAttribute('role', 'status');
            container.setAttribute('aria-live', 'polite');
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        container.appendChild(toast);
        while (container.children.length > CONFIG.TOAST_MAX_VISIBLE) {
            container.removeChild(container.firstChild);
        }
        setTimeout(() => {
            toast.classList.add('toast-hide');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            setTimeout(() => toast.remove(), CONFIG.TOAST_REMOVE_FALLBACK_MS);
        }, CONFIG.TOAST_DURATION_MS);
    },

    init() {
        this.showSection('menu');
        this.updateDashboard();
        this.renderRegulationList();
        this.populateCategorySelect();
        this.setupKeyboardShortcuts();
        this.examFlagged = new Set();
        this.initDarkMode();
        this.initWebVitals();

        // Service Worker: 網站版本不註冊（避免快取廣告腳本）
        // 如需離線功能，改用單檔版本 室內空品題庫備考系統.html

        // Ad blocker 偵測：隱藏空白廣告容器
        setTimeout(() => {
            if (!window.adsbygoogle || !document.querySelector('.adsbygoogle[data-ad-status]')) {
                document.querySelectorAll('.ad-container').forEach(el => {
                    el.style.display = 'none';
                });
            }
        }, 3000);
        
        // 隱藏載入指示器
        const loading = document.getElementById('loadingOverlay');
        if (loading) {
            loading.classList.add('hidden');
            setTimeout(() => loading.style.display = 'none', 300);
        }
    },

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // 避免在輸入框中觸發
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Enter - 提交答案
            if (e.key === 'Enter' && this.currentSection === 'practice') {
                e.preventDefault();
                this.submitAnswer();
            }
            
            // N - 下一題
            if (e.key === 'n' || e.key === 'N' || e.key === 'ㄋ') {
                if (this.currentSection === 'practice') {
                    this.nextQuestion();
                }
            }
            
            // F - 收藏
            if (e.key === 'f' || e.key === 'F' || e.key === 'ㄈ') {
                if (this.currentSection === 'practice') {
                    this.toggleFavorite();
                }
            }
            
            // U - 不確定
            if (e.key === 'u' || e.key === 'U' || e.key === 'ㄟ') {
                if (this.currentSection === 'practice') {
                    this.toggleUncertain();
                }
            }
            
            // A/B/C/D - 選擇答案
            if (['a', 'b', 'c', 'd', 'A', 'B', 'C', 'D'].includes(e.key) && this.currentSection === 'practice') {
                this.selectChoice(e.key.toUpperCase(), event?.currentTarget);
            }
            
            // Escape - 返回主選單
            if (e.key === 'Escape') {
                if (this.currentSection === 'practice' || this.currentSection === 'exam') {
                    if (confirm('確定返回主選單？')) {
                        this.showSection('menu');
                    }
                }
            }
        });
    },

    showSection(section) {
        // 如果當前在考試模式並且要離開，清除計時器
        if (this.currentSection === 'exam' && section !== 'exam') {
            clearInterval(this.examTimerInterval);
            this.examTimerInterval = null;
        }
        // 離開練習時停止練習計時器
        if (this.currentSection === 'practice' && section !== 'practice') {
            this.stopPracticeTimer();
        }

        this.currentSection = section;

        // 考試模式時隱藏廣告
        document.body.classList.toggle('exam-mode', section === 'exam');

        const sections = ['mainMenu', 'seoOverview', 'dashboardSection', 'practiceSection', 'examSection', 'reviewSection', 'regulationsSection', 'manageSection'];
        sections.forEach(s => {
            const el = document.getElementById(s);
            if (el) el.style.display = 'none';
        });

        if (section === 'menu') {
            document.getElementById('mainMenu').style.display = 'grid';
            document.getElementById('seoOverview').style.display = 'block';
            this.updateDashboard();
        } else {
            const sectionEl = document.getElementById(section + 'Section');
            if (sectionEl) sectionEl.style.display = 'block';
        }

        if (section === 'review') {
            this.showReviewTab('wrong');
        }
    },

    // ========== 儀表板 ==========
    updateDashboard() {
        const stats = Storage.getOverallStats();
        const wrongList = Storage.getWrongQuestions();
        
        document.getElementById('statTotal').textContent = stats.total;
        document.getElementById('statPracticed').textContent = stats.practiced;
        document.getElementById('statCorrect').textContent = stats.practiced > 0 
            ? Math.round(stats.correct / stats.practiced * 100) + '%' 
            : '0%';
        document.getElementById('statWrong').textContent = wrongList.length;

        const progress = stats.total > 0 ? Math.round(stats.practiced / stats.total * 100) : 0;
        document.getElementById('progressFill').style.width = progress + '%';
        document.getElementById('progressText').textContent = `已完成 ${progress}% 的題庫`;

        this.renderCategoryProgress();
        this.renderRecommend();
    },

    renderCategoryProgress() {
        const catStats = Storage.getCategoryStats();
        const container = document.getElementById('categoryList');
        let html = '';
        
        Object.keys(catStats).forEach(cat => {
            const s = catStats[cat];
            const percent = s.total > 0 ? Math.round(s.practiced / s.total * 100) : 0;
            html += `
                <div class="category-item">
                    <div class="category-name">${cat}</div>
                    <div class="category-stats">
                        <span>${s.practiced}/${s.total}</span>
                        <span>${percent}%</span>
                    </div>
                    <div class="category-bar">
                        <div class="category-bar-fill" style="width:${percent}%"></div>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    },

    renderRecommend() {
        const container = document.getElementById('recommendList');
        const wrongList = Storage.getWrongQuestions();
        const catStats = Storage.getCategoryStats();
        
        let recommends = [];
        
        // 推薦複習錯題
        if (wrongList.length > 0) {
            recommends.push({
                type: '错题',
                count: wrongList.length,
                action: () => this.showSection('review')
            });
        }

        // 找出最弱類別
        let weakest = null;
        let lowestPercent = 100;
        Object.keys(catStats).forEach(cat => {
            const s = catStats[cat];
            if (s.practiced > 0) {
                const percent = Math.round((s.practiced - s.correct) / s.practiced * 100);
                if (percent < lowestPercent) {
                    lowestPercent = percent;
                    weakest = cat;
                }
            }
        });

        if (weakest) {
            recommends.push({
                type: '加強練習',
                category: weakest,
                action: () => {
                    this.startPractice('category', weakest);
                }
            });
        }

        let html = '';
        recommends.forEach(r => {
            if (r.type === '错题') {
                html += `<div class="category-item" onclick="App.showSection('review')">
                    <div class="category-name">📌 错题複習</div>
                    <div class="category-stats">${r.count} 題待複習</div>
                </div>`;
            } else {
                html += `<div class="category-item" onclick="App.startPractice('category', '${r.category}')">
                    <div class="category-name">📚 ${r.category}</div>
                    <div class="category-stats">需要加強</div>
                </div>`;
            }
        });

        if (!html) {
            html = '<p style="color:var(--secondary)">完成更多練習後，系統會給予推薦</p>';
        }
        container.innerHTML = html;
    },

    // ========== 練習系統 ==========
    showPracticeModes() {
        document.getElementById('practiceModeSelect').style.display = 'block';
        document.getElementById('categorySelect').style.display = 'none';
        document.getElementById('practiceArea').style.display = 'none';
        document.getElementById('practiceComplete').style.display = 'none';
    },

    showCategorySelect() {
        document.getElementById('practiceModeSelect').style.display = 'none';
        document.getElementById('categorySelect').style.display = 'block';
        document.getElementById('practiceArea').style.display = 'none';
        document.getElementById('practiceComplete').style.display = 'none';
    },

    startPractice(mode, category = null) {
        this.practiceMode = mode;
        let questions = [];

        if (mode === 'category' && category) {
            questions = [...QUESTIONS[category]];
        } else if (mode === 'random') {
            Object.keys(QUESTIONS).forEach(cat => {
                questions = questions.concat(QUESTIONS[cat]);
            });
            this.shuffleArray(questions);
        } else if (mode === 'timed') {
            Object.keys(QUESTIONS).forEach(cat => {
                questions = questions.concat(QUESTIONS[cat]);
            });
            this.shuffleArray(questions);
            questions = questions.slice(0, CONFIG.TIMED_PRACTICE_COUNT);
        } else if (mode === 'weak') {
            const wrongList = Storage.getWrongQuestions();
            questions = wrongList;
            if (questions.length === 0) {
                this.showToast('目前沒有錯題記錄', 'warning');
                return;
            }
        }

        if (questions.length === 0) {
            this.showToast('沒有可練習的題目', 'warning');
            return;
        }

        this.practiceQuestions = questions;
        this.practiceIndex = 0;
        this.practiceCorrect = 0;
        this.practiceAttempted = 0;
        this.practiceStartTime = Date.now();

        document.getElementById('practiceModeSelect').style.display = 'none';
        document.getElementById('categorySelect').style.display = 'none';
        document.getElementById('practiceComplete').style.display = 'none';
        document.getElementById('practiceArea').style.display = 'block';

        // 限時練習：啟動 30 分鐘倒數
        this.stopPracticeTimer();
        if (mode === 'timed') {
            this.startPracticeTimer(30 * 60);
        }

        this.showQuestion();
    },

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    },

    // 題目附圖：渲染 <img> 並依題幹文字生成有意義的 alt
    renderQuestionImage(containerId, q) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        if (!q.image) {
            container.style.display = 'none';
            return;
        }
        const img = document.createElement('img');
        img.src = 'img/' + q.image;
        img.loading = 'lazy';
        const stem = (q.question || '').replace(/\s+/g, ' ').trim();
        img.alt = stem
            ? '題目附圖：' + (stem.length > CONFIG.IMAGE_ALT_MAX_LENGTH
                ? stem.slice(0, CONFIG.IMAGE_ALT_MAX_LENGTH) + '…'
                : stem)
            : '題目附圖';
        container.appendChild(img);
        container.style.display = 'block';
    },

    showQuestion() {
        if (this.practiceIndex >= this.practiceQuestions.length) {
            this.showPracticeComplete();
            return;
        }

        const q = this.practiceQuestions[this.practiceIndex];
        const catName = q.category || '全部';
        
        document.getElementById('questionCount').textContent = catName;
        document.getElementById('questionProgress').textContent = `${this.practiceIndex + 1} / ${this.practiceQuestions.length}`;
        document.getElementById('questionText').textContent = q.question;
        document.getElementById('userAnswer').value = '';
        document.getElementById('resultSection').style.display = 'none';
        document.getElementById('answer-buttons').style.display = 'flex';
        this.selectedChoice = null;

        // 圖片
        this.renderQuestionImage('questionImage', q);

        // 題目類型
        if (q.type === 'choice') {
            document.getElementById('fillBlankArea').style.display = 'none';
            document.getElementById('choiceArea').style.display = 'block';
            this.renderChoiceOptions(q, 'choiceOptions');
        } else {
            document.getElementById('fillBlankArea').style.display = 'block';
            document.getElementById('choiceArea').style.display = 'none';
        }

        // 更新收藏/不確定按鈕狀態
        this.updateMarkButtons();
    },

    renderChoiceOptions(q, containerId) {
        const container = document.getElementById(containerId);
        const options = q.options || {};
        let html = '';
        ['A', 'B', 'C', 'D'].forEach(label => {
            if (options[label]) {
                html += `
                    <div class="choice-option" onclick="App.selectChoice('${label}', this)">
                        <div class="option-label">${label}</div>
                        <div class="option-text">${options[label]}</div>
                    </div>
                `;
            }
        });
        container.innerHTML = html;
    },

    selectChoice(label, element) {
        this.selectedChoice = label;
        document.querySelectorAll('.choice-option').forEach(el => {
            el.classList.remove('selected');
        });
        if (element) {
            element.classList.add('selected');
        }
    },

    submitAnswer() {
        const q = this.practiceQuestions[this.practiceIndex];
        let userAnswer = '';
        let isCorrect = false;

        if (q.type === 'choice') {
            if (!this.selectedChoice) {
                this.showToast('請選擇一個選項', 'warning');
                return;
            }
            userAnswer = this.selectedChoice;
            isCorrect = userAnswer.toUpperCase() === (q.answer || '').toUpperCase();
        } else {
            userAnswer = document.getElementById('userAnswer').value.trim();
            if (!userAnswer) {
                this.showToast('請輸入答案', 'warning');
                return;
            }
            // 關鍵字比對
            isCorrect = checkKeywordAnswer(userAnswer, q.answer);
        }

        Storage.markPracticed(q.id);
        Storage.updateQuestionStats(q.id, isCorrect);

        if (!isCorrect) {
            Storage.addWrongQuestion(q);
        }

        this.practiceAttempted++;
        if (isCorrect) this.practiceCorrect++;

        this.showResult(isCorrect, userAnswer);
    },

    showSolution() {
        const q = this.practiceQuestions[this.practiceIndex];
        let userAnswer = '';
        if (q.type === 'choice') {
            userAnswer = this.selectedChoice || '未選擇';
        } else {
            userAnswer = document.getElementById('userAnswer').value.trim() || '未填寫';
        }
        this.showResult(null, userAnswer, true);
    },

    showResult(isCorrect, userAnswer, showOnly = false) {
        const q = this.practiceQuestions[this.practiceIndex];

        const resultSection = document.getElementById('resultSection');
        const answerButtons = document.getElementById('answer-buttons');

        if (resultSection) resultSection.style.display = 'block';
        if (answerButtons) answerButtons.style.display = 'none';

        const headerEl = document.getElementById('resultHeader');
        if (isCorrect !== null) {
            headerEl.innerHTML = isCorrect ? '✅ 回答正確！' : '❌ 回答錯誤';
            headerEl.className = 'result-header ' + (isCorrect ? 'correct' : 'wrong');
        } else {
            headerEl.innerHTML = '📝 解答';
            headerEl.className = 'result-header';
        }

        let answerHtml = '<strong>你的答案：</strong>' + userAnswer;
        if (isCorrect === false || showOnly) {
            answerHtml += '<br><strong>正確答案：</strong>' + (q.answer || '無');
        }
        document.getElementById('correctAnswer').innerHTML = answerHtml;

        let expHtml = '';
        if (q.explanation) {
            expHtml = '<strong>解析：</strong><div class="explanation-content">' + this.formatExplanation(q.explanation) + '</div>';
        } else if (q.source) {
            expHtml = '<strong>法規來源：</strong>' + q.source;
        }
        document.getElementById('explanation').innerHTML = expHtml || '<em>無解析</em>';
    },

    formatExplanation(text) {
        if (!text) return '';
        // 替換編號格式（如 1. 2. 3.）為換行
        let formatted = text.replace(/(\d)[\.．、](?=\S)/g, '$1<br><br>');
        // 替換換行符號
        formatted = formatted.replace(/\n/g, '<br>');
        return formatted;
    },

    nextQuestion() {
        this.practiceIndex++;
        this.showQuestion();
    },

    toggleFavorite() {
        const q = this.practiceQuestions[this.practiceIndex];
        const isFav = Storage.toggleFavorite(q);
        const btn = document.getElementById('favoriteBtn');
        btn.textContent = isFav ? '★ 已收藏' : '☆ 收藏';
        btn.className = isFav ? 'btn btn-warning' : 'btn btn-secondary';
    },

    toggleUncertain() {
        const q = this.practiceQuestions[this.practiceIndex];
        const isUncertain = Storage.toggleUncertain(q);
        const btn = document.getElementById('uncertainBtn');
        btn.textContent = isUncertain ? '？ 已標記' : '？ 不確定';
        btn.className = isUncertain ? 'btn btn-info' : 'btn btn-secondary';
    },

    updateMarkButtons() {
        const q = this.practiceQuestions[this.practiceIndex];
        const isFav = Storage.isFavorite(q.id);
        const isUncertain = Storage.isUncertain(q.id);
        
        const favBtn = document.getElementById('favoriteBtn');
        const uncertainBtn = document.getElementById('uncertainBtn');
        
        if (favBtn) {
            favBtn.textContent = isFav ? '★ 已收藏' : '☆ 收藏';
            favBtn.className = isFav ? 'btn btn-warning' : 'btn btn-secondary';
        }
        if (uncertainBtn) {
            uncertainBtn.textContent = isUncertain ? '？ 已標記' : '？ 不確定';
            uncertainBtn.className = isUncertain ? 'btn btn-info' : 'btn btn-secondary';
        }
    },

    quitPractice() {
        if (confirm('確定結束練習？')) {
            this.stopPracticeTimer();
            this.showPracticeModes();
            this.updateDashboard();
        }
    },

    populateCategorySelect() {
        const container = document.getElementById('categoryGrid');
        let html = '';
        Object.keys(QUESTIONS).forEach(cat => {
            const count = QUESTIONS[cat].length;
            html += `
                <div class="category-item" onclick="App.startPractice('category', '${cat}')">
                    <div class="category-name">${cat}</div>
                    <div class="category-stats">${count} 題</div>
                </div>
            `;
        });
        container.innerHTML = html;

        // 題庫管理的類別下拉
        const select = document.getElementById('newQuestionCategory');
        if (select) {
            let options = '';
            Object.keys(QUESTIONS).forEach(cat => {
                options += `<option value="${cat}">${cat}</option>`;
            });
            select.innerHTML = options;
        }
    },

    // ========== 模擬考試 ==========
    startExam() {
        let allQuestions = [];
        Object.keys(QUESTIONS).forEach(cat => {
            allQuestions = allQuestions.concat(QUESTIONS[cat]);
        });
        this.shuffleArray(allQuestions);
        this.examQuestions = allQuestions.slice(0, CONFIG.EXAM_QUESTION_COUNT);
        
        this.examAnswers = {};
        this.examCurrentIndex = 0;
        this.examStartTime = Date.now();
        this.examFlagged = new Set();

        // 標準化跨站考試漏斗事件
        this.track('exam_started', {
            mode: 'mock',
            question_count: this.examQuestions.length
        });

        document.getElementById('examStart').style.display = 'none';
        document.getElementById('examArea').style.display = 'block';
        document.getElementById('examResult').style.display = 'none';

        this.examTimerInterval = setInterval(() => this.updateTimer(), CONFIG.TIMER_INTERVAL_MS);
        this.renderExamNavDots();
        this.showExamQuestion();
    },

    updateTimer() {
        const elapsed = Math.floor((Date.now() - this.examStartTime) / 1000);
        const remaining = Math.max(0, CONFIG.EXAM_TIME_MINUTES * 60 - elapsed);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        document.getElementById('examTimer').textContent = 
            `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        if (remaining <= 0) {
            this.finishExam();
        }
    },

    renderExamNavDots() {
        const container = document.getElementById('examNavDots');
        let html = '';
        for (let i = 0; i < this.examQuestions.length; i++) {
            let cls = 'nav-dot';
            if (i === this.examCurrentIndex) cls += ' current';
            if (this.examAnswers[i]) cls += ' answered';
            if (this.examFlagged && this.examFlagged.has(i)) cls += ' flagged';
            html += `<div class="${cls}" onclick="App.goToExamQuestion(${i})">${i + 1}</div>`;
        }
        container.innerHTML = html;
    },

    showExamQuestion() {
        const q = this.examQuestions[this.examCurrentIndex];
        if (!q) return;
        document.getElementById('examProgress').textContent = 
            `${this.examCurrentIndex + 1} / ${this.examQuestions.length}`;
        document.getElementById('examQuestionText').textContent = q.question;
        document.getElementById('examUserAnswer').value = this.examAnswers[this.examCurrentIndex]?.answer || '';
        this.selectedChoice = this.examAnswers[this.examCurrentIndex]?.choice || null;

        this.renderQuestionImage('examQuestionImage', q);

        if (q.type === 'choice') {
            document.getElementById('examFillArea').style.display = 'none';
            document.getElementById('examChoiceArea').style.display = 'block';
            this.renderChoiceOptions(q, 'examChoiceOptions');
        } else {
            document.getElementById('examFillArea').style.display = 'block';
            document.getElementById('examChoiceArea').style.display = 'none';
        }

        this.renderExamNavDots();
        this.updateExamFlagBtn();
    },

    submitExamAnswer() {
        const q = this.examQuestions[this.examCurrentIndex];
        let userAnswer = '';
        let isCorrect = false;

        if (q.type === 'choice') {
            if (!this.selectedChoice) {
                this.showToast('請選擇一個選項', 'warning');
                return;
            }
            userAnswer = this.selectedChoice;
            isCorrect = userAnswer.toUpperCase() === (q.answer || '').toUpperCase();
        } else {
            userAnswer = document.getElementById('examUserAnswer').value.trim();
            if (!userAnswer) {
                this.showToast('請輸入答案', 'warning');
                return;
            }
            // 關鍵字比對
            isCorrect = checkKeywordAnswer(userAnswer, q.answer);
        }

        this.examAnswers[this.examCurrentIndex] = {
            answer: userAnswer,
            isCorrect: isCorrect,
            choice: this.selectedChoice
        };

        // 保存答案草稿
        Storage.saveExamDraft({
            examAnswers: this.examAnswers,
            examQuestions: this.examQuestions,
            examCurrentIndex: this.examCurrentIndex,
            examStartTime: this.examStartTime
        });

        Storage.markPracticed(q.id);
        Storage.updateQuestionStats(q.id, isCorrect);

        if (!isCorrect) {
            Storage.addWrongQuestion(q);
        }

        this.renderExamNavDots();

        if (this.examCurrentIndex < this.examQuestions.length - 1) {
            this.examCurrentIndex++;
            this.showExamQuestion();
        } else {
            if (confirm('已是最後一題，是否結束考試？')) {
                this.finishExam();
            }
        }
    },

    prevExamQuestion() {
        if (this.examCurrentIndex > 0) {
            this.examCurrentIndex--;
            this.showExamQuestion();
        }
    },

    nextExamQuestion() {
        if (this.examCurrentIndex < this.examQuestions.length - 1) {
            this.examCurrentIndex++;
            this.showExamQuestion();
        }
    },

    goToExamQuestion(index) {
        if (index < 0 || index >= this.examQuestions.length) return;
        this.examCurrentIndex = index;
        this.showExamQuestion();
    },

    finishExam() {
        clearInterval(this.examTimerInterval);

        let total = Object.keys(this.examAnswers).length;
        let correct = 0;
        Object.values(this.examAnswers).forEach(a => {
            if (a.isCorrect) correct++;
        });

        const elapsed = Math.floor((Date.now() - this.examStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const percent = total > 0 ? Math.round(correct / this.examQuestions.length * 100) : 0;

        document.getElementById('examArea').style.display = 'none';
        document.getElementById('examResult').style.display = 'block';

        document.getElementById('resultTotal').textContent = this.examQuestions.length;
        document.getElementById('resultCorrect').textContent = correct;
        document.getElementById('resultPercent').textContent = percent + '%';
        document.getElementById('resultTime').textContent = 
            `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        const statusEl = document.getElementById('resultStatus');
        if (percent >= CONFIG.PASSING_THRESHOLD) {
            statusEl.textContent = '🎉 恭喜及格！';
            statusEl.className = 'result-status pass';
        } else {
            statusEl.textContent = '📚 繼續加油！';
            statusEl.className = 'result-status fail';
        }

        // 儲存含詳解的考試記錄
        const details = this.examQuestions.map((q, i) => ({
            question: q.question,
            category: q.category || '',
            type: q.type,
            userAnswer: this.examAnswers[i]?.answer || '未作答',
            correctAnswer: q.answer || '',
            isCorrect: this.examAnswers[i]?.isCorrect || false,
            explanation: q.explanation || null
        }));
        Storage.addExamRecord({
            date: new Date().toISOString(),
            total: this.examQuestions.length,
            correct: correct,
            percent: percent,
            details: details
        });
        // 標準化跨站考試漏斗事件
        this.track('exam_completed', {
            mode: 'mock',
            total: this.examQuestions.length,
            score: percent,
            passed: percent >= CONFIG.PASSING_THRESHOLD
        });
        // 重置詳解區
        const reviewEl = document.getElementById('examReview');
        if (reviewEl) reviewEl.style.display = 'none';
    },

    // ========== 複習中心 ==========
    showReviewTab(tab) {
        document.querySelectorAll('.review-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.currentTarget.classList.add('active');

        document.getElementById('wrongList').style.display = 'none';
        document.getElementById('favoriteList').style.display = 'none';
        document.getElementById('uncertainList').style.display = 'none';

        if (tab === 'wrong') {
            this.renderWrongList();
            document.getElementById('wrongList').style.display = 'block';
            // 標準化跨站錯題複習漏斗事件
            this.track('wrongbook_review', {
                total_wrong: Storage.getWrongQuestions().length,
                source: 'review_center'
            });
        } else if (tab === 'favorite') {
            this.renderFavoriteList();
            document.getElementById('favoriteList').style.display = 'block';
        } else if (tab === 'uncertain') {
            this.renderUncertainList();
            document.getElementById('uncertainList').style.display = 'block';
        } else if (tab === 'history') {
            this.renderHistoryList();
            document.getElementById('historyList').style.display = 'block';
        }
    },

    renderWrongList() {
        const list = Storage.getWrongQuestions();
        this.renderReviewList(list, 'wrongList');
    },

    renderFavoriteList() {
        const list = Storage.getFavorites();
        this.renderReviewList(list, 'favoriteList');
    },

    renderUncertainList() {
        const list = Storage.getUncertain();
        this.renderReviewList(list, 'uncertainList');
    },

    renderHistoryList() {
        const history = Storage.getExamHistory();
        const container = document.getElementById('historyList');
        
        if (history.length === 0) {
            container.innerHTML = '<div class="review-item" style="text-align:center;color:var(--secondary)">目前沒有考試記錄</div>';
            return;
        }

        let html = '';
        history.slice().reverse().forEach((exam, index) => {
            const date = new Date(exam.date).toLocaleDateString();
            const time = new Date(exam.date).toLocaleTimeString();
            const score = Math.round(exam.correct / exam.total * 100);
            const scoreClass = score >= 60 ? 'var(--success)' : 'var(--danger)';
            
            html += `
                <div class="review-item" onclick="App.showExamDetail(${index})">
                    <div class="review-item-content">
                        <h4>${this.sanitize(date)} ${this.sanitize(time)}</h4>
                        <p>
                            <span style="color:${this.sanitize(scoreClass)}">${this.sanitize(score)}分</span> 
                            （${this.sanitize(exam.correct)}/${this.sanitize(exam.total)} 題答對）
                        </p>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    },

    showExamDetail(index) {
        const history = Storage.getExamHistory().slice().reverse();
        const exam = history[index];
        if (!exam) return;
        
        let detail = `考試時間：${new Date(exam.date).toLocaleString()}\n\n`;
        detail += `答題情形：${exam.correct}/${exam.total} 答對\n`;
        detail += `得分：${Math.round(exam.correct / exam.total * 100)}分\n\n`;
        detail += `答題詳情：\n`;
        
        if (exam.details) {
            exam.details.forEach((d, i) => {
                const status = d.isCorrect ? '✓' : '✗';
                detail += `\n${i+1}. ${status} ${d.question.substring(0, 30)}...`;
            });
        }
        
        alert(detail);
    },

    renderReviewList(list, containerId) {
        const container = document.getElementById(containerId);
        const listType = containerId === 'wrongList' ? 'wrong' : 
                         containerId === 'favoriteList' ? 'favorite' : 'uncertain';
        
        if (list.length === 0) {
            container.innerHTML = '<div class="review-item" style="text-align:center;color:var(--secondary)">目前沒有資料</div>';
            return;
        }

        let html = '';
        list.forEach((q, index) => {
            html += `
                <div class="review-item">
                    <div class="review-item-content" onclick="App.showQuestionDetail('${this.sanitize(q.id)}')">
                        <h4>${this.sanitize(q.question)}</h4>
                        <p><strong>你的答案：</strong>${this.sanitize(q.userAnswer || q.answer || '無')}</p>
                        <div class="meta">
                            <span>題號：${this.sanitize(q.id)}</span>
                            ${q.date ? '<span>日期：' + new Date(q.date).toLocaleDateString() + '</span>' : ''}
                        </div>
                    </div>
                    <button class="btn-remove" onclick="App.removeFromList('${listType}', '${this.sanitize(q.id)}')">×</button>
                </div>
            `;
        });
        
        // 添加全清除按鈕
        html += `
            <div style="text-align:center;margin-top:20px;">
                <button class="btn btn-danger btn-small" onclick="App.clearList('${listType}')">清除全部</button>
            </div>
        `;
        container.innerHTML = html;
    },

    removeFromList(listType, questionId) {
        if (listType === 'wrong') {
            Storage.removeWrongQuestion(questionId);
            this.showReviewTab('wrong');
        } else if (listType === 'favorite') {
            Storage.toggleFavorite({ id: questionId });
            this.showReviewTab('favorite');
        } else if (listType === 'uncertain') {
            Storage.toggleUncertain({ id: questionId });
            this.showReviewTab('uncertain');
        }
        this.updateDashboard();
    },

    clearList(listType) {
        if (!confirm('確定要清除全部嗎？')) return;
        if (listType === 'wrong') {
            Storage.clearWrongQuestions();
            this.showReviewTab('wrong');
        } else if (listType === 'favorite') {
            const favorites = Storage.getFavorites();
            favorites.forEach(q => Storage.toggleFavorite(q));
            this.showReviewTab('favorite');
        } else if (listType === 'uncertain') {
            const uncertain = Storage.getUncertain();
            uncertain.forEach(q => Storage.toggleUncertain(q));
            this.showReviewTab('uncertain');
        }
        this.updateDashboard();
    },

    showQuestionDetail(questionId) {
        let question = null;
        Object.keys(QUESTIONS).forEach(cat => {
            const found = QUESTIONS[cat].find(q => q.id === questionId);
            if (found) question = found;
        });
        
        if (!question) {
            // 可能是在錯題本或收藏中
            const wrong = Storage.getWrongQuestions().find(q => q.id === questionId);
            const fav = Storage.getFavorites().find(q => q.id === questionId);
            question = wrong || fav;
        }

        if (question) {
            alert(`題目：${question.question}\n\n答案：${question.answer || '無'}\n\n解析：${question.explanation || '無'}`);
        }
    },

    // ========== 法規 ==========
    renderRegulationList(filter = '') {
        const container = document.getElementById('regulationList');
        const filterLower = filter.toLowerCase();
        let html = '';
        REGULATIONS.forEach(reg => {
            // 搜尋標題和內容
            if (filter && !reg.title.toLowerCase().includes(filterLower) && !reg.content.toLowerCase().includes(filterLower)) {
                return;
            }
            html += `
                <div class="regulation-item" onclick="App.showRegulation('${this.sanitize(reg.id)}')">
                    ${this.sanitize(reg.title)}
                </div>
            `;
        });
        if (!html) {
            html = '<div style="text-align:center;color:var(--secondary);padding:20px;">找不到符合的法規</div>';
        }
        container.innerHTML = html;
    },

    searchRegulations(keyword) {
        this.renderRegulationList(keyword);
    },

    showRegulation(id) {
        const reg = REGULATIONS.find(r => r.id === id);
        if (!reg) {
            this.showToast('法規不存在', 'error');
            return;
        }
        document.getElementById('regulationList').style.display = 'none';
        document.getElementById('regulationContent').style.display = 'block';
        document.getElementById('regulationTitle').textContent = reg.title;
        const textEl = document.getElementById('regulationText');
        textEl.innerHTML = this.formatRegulation(reg.content);
    },

    formatRegulation(text) {
        if (!text) return '';
        let formatted = text;
        
        // 1. 處理條號（第 X 條）- 必須最優先處理
        formatted = formatted.replace(/第\s*([一二三四五六七八九十百零\d]+)\s*條/g, '【第$1條】');
        
        // 2. 處理中文數字編號（一、二、三...）
        formatted = formatted.replace(/一、/g, '<br>一、');
        formatted = formatted.replace(/二、/g, '<br>二、');
        formatted = formatted.replace(/三、/g, '<br>三、');
        formatted = formatted.replace(/四、/g, '<br>四、');
        formatted = formatted.replace(/五、/g, '<br>五、');
        formatted = formatted.replace(/六、/g, '<br>六、');
        formatted = formatted.replace(/七、/g, '<br>七、');
        formatted = formatted.replace(/八、/g, '<br>八、');
        formatted = formatted.replace(/九、/g, '<br>九、');
        formatted = formatted.replace(/十、/g, '<br>十、');
        
        // 3. 處理阿拉伯數字編號（1. 2. 3.）
        formatted = formatted.replace(/\n(\d+)\.\s*/g, '<br>$1. ');
        
        // 4. 處理項目符號（- xxx）
        formatted = formatted.replace(/\n-\s*/g, '<br>• ');
        
        // 5. 處理條號標記轉換為顯示用HTML
        formatted = formatted.replace(/【第([^】]+)條】/g, '<div class="reg-article">第$1條</div>');
        
        // 6. 處理換行
        formatted = formatted.replace(/\n/g, '<br>');
        
        return '<div class="regulation-text-formatted">' + formatted + '</div>';
    },

    showRegulationList() {
        document.getElementById('regulationList').style.display = 'block';
        document.getElementById('regulationContent').style.display = 'none';
        document.getElementById('regulationSearch').value = '';
        this.renderRegulationList();
    },

    // ========== 題庫管理 ==========
    showManageTab(tab) {
        document.querySelectorAll('.manage-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.currentTarget.classList.add('active');

        document.getElementById('questionList').style.display = 'none';
        document.getElementById('addQuestionForm').style.display = 'none';
        document.getElementById('backupSection').style.display = 'none';

        if (tab === 'list') {
            document.getElementById('questionList').style.display = 'block';
            this.renderQuestionList();
        } else if (tab === 'add') {
            document.getElementById('addQuestionForm').style.display = 'block';
        } else if (tab === 'backup') {
            document.getElementById('backupSection').style.display = 'block';
        }
    },

    exportData() {
        const data = Storage.exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `室內空品備考備份_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    importData(fileInput) {
        const file = fileInput.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const result = Storage.importData(e.target.result);
                if (result.success) {
                    this.showToast(`成功匯入 ${result.count} 筆資料`, 'success');
                    this.updateDashboard();
                } else {
                    this.showToast('匯入失敗：' + result.error, 'error');
                }
            } catch (err) {
                this.showToast('匯入失敗：檔案格式錯誤', 'error');
            }
        };
        reader.readAsText(file);
    },

    clearAllData() {
        if (!confirm('確定要清除所有資料嗎？這將刪除所有學習進度、錯題紀錄和收藏！')) return;
        if (!confirm('此操作無法復原，確定嗎？')) return;
        Storage.clearAllData();
        this.showToast('所有資料已清除', 'success');
        this.updateDashboard();
    },

    renderQuestionList() {
        const container = document.getElementById('questionList');
        let html = '<h3>題目列表</h3>';
        
        Object.keys(QUESTIONS).forEach(cat => {
            html += `<h4 style="margin:15px 0 10px">${cat} (${QUESTIONS[cat].length}題)</h4>`;
            QUESTIONS[cat].slice(0, 5).forEach(q => {
                html += `
                    <div class="question-list-item">
                        <div><strong>${q.id}</strong>: ${q.question.substring(0, 50)}...</div>
                        <div class="actions">
                            <button class="btn btn-small btn-secondary" onclick="App.deleteQuestion('${cat}', '${q.id}')">刪除</button>
                        </div>
                    </div>
                `;
            });
            if (QUESTIONS[cat].length > 5) {
                html += `<p style="color:var(--secondary)">...還有 ${QUESTIONS[cat].length - 5} 題</p>`;
            }
        });
        
        container.innerHTML = html;
    },

    deleteQuestion(category, questionId) {
        if (!confirm('確定刪除此題目？')) return;
        const idx = QUESTIONS[category].findIndex(q => q.id === questionId);
        if (idx >= 0) {
            QUESTIONS[category].splice(idx, 1);
            this.renderQuestionList();
            this.showToast('已刪除', 'success');
        }
    },

    addQuestion() {
        const type = document.getElementById('newQuestionType').value;
        const category = document.getElementById('newQuestionCategory').value;
        const questionText = document.getElementById('newQuestionText').value.trim();
        const answer = document.getElementById('newQuestionAnswer').value.trim();
        const explanation = document.getElementById('newQuestionExplanation').value.trim();

        if (!questionText) {
            this.showToast('請輸入題目', 'warning');
            return;
        }

        if (!answer) {
            this.showToast('請輸入答案', 'warning');
            return;
        }

        const newQ = {
            id: category.substring(0, 4) + '_' + Date.now(),
            type: type,
            question: questionText,
            answer: answer,
            explanation: explanation || null,
            category: category
        };

        if (type === 'choice') {
            const optionsText = document.getElementById('newQuestionOptionsText').value;
            newQ.options = {};
            optionsText.split('\n').forEach(line => {
                const match = line.match(/^([A-D])\.\s*(.+)$/);
                if (match) {
                    newQ.options[match[1]] = match[2];
                }
            });
        }

        if (!QUESTIONS[category]) {
            QUESTIONS[category] = [];
        }
        QUESTIONS[category].push(newQ);

        this.showToast('題目已新增', 'success');
        document.getElementById('newQuestionText').value = '';
        document.getElementById('newQuestionAnswer').value = '';
        document.getElementById('newQuestionExplanation').value = '';
        document.getElementById('newQuestionOptionsText').value = '';
    },

    // ===== 深色模式 =====
    toggleDarkMode() {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('iaqDarkMode', isDark ? '1' : '0');
        const btn = document.getElementById('darkModeToggle');
        if (btn) btn.textContent = isDark ? '☀️' : '🌙';
    },

    initDarkMode() {
        if (localStorage.getItem('iaqDarkMode') === '1') {
            document.body.classList.add('dark-mode');
            const btn = document.getElementById('darkModeToggle');
            if (btn) btn.textContent = '☀️';
        }
    },

    // ===== 題目搜尋 =====
    searchQuestions(keyword) {
        const resultsEl = document.getElementById('searchResults');
        if (!keyword || keyword.trim().length < 2) {
            resultsEl.style.display = 'none';
            return;
        }
        const kw = keyword.toLowerCase();
        const results = [];
        Object.keys(QUESTIONS).forEach(cat => {
            QUESTIONS[cat].forEach(q => {
                if (q.question.toLowerCase().includes(kw) ||
                    (q.answer && q.answer.toLowerCase().includes(kw))) {
                    results.push(q);
                }
            });
        });
        if (results.length === 0) {
            resultsEl.innerHTML = '<div class="search-empty">找不到符合題目</div>';
        } else {
            const cap = results.slice(0, 30);
            let html = `<div class="search-count">找到 ${results.length} 題${results.length > 30 ? '（僅顯示前 30 筆）' : ''}</div>`;
            cap.forEach(q => {
                html += `
                    <div class="search-result-item" onclick="App.startSearchPractice('${this.sanitize(q.id)}')">
                        <div class="search-q-text">${this.sanitize(q.question)}</div>
                        <div class="search-q-meta">${this.sanitize(q.category)} · ${q.type === 'choice' ? '選擇題' : '填充題'}</div>
                    </div>`;
            });
            resultsEl.innerHTML = html;
        }
        resultsEl.style.display = 'block';
    },

    startSearchPractice(questionId) {
        let question = null;
        Object.keys(QUESTIONS).forEach(cat => {
            const found = QUESTIONS[cat].find(q => q.id === questionId);
            if (found) question = found;
        });
        if (!question) return;
        this.practiceMode = 'search';
        this.practiceQuestions = [question];
        this.practiceIndex = 0;
        this.practiceCorrect = 0;
        this.practiceAttempted = 0;
        this.practiceStartTime = Date.now();
        document.getElementById('questionSearch').value = '';
        document.getElementById('searchResults').style.display = 'none';
        document.getElementById('practiceModeSelect').style.display = 'none';
        document.getElementById('practiceComplete').style.display = 'none';
        document.getElementById('practiceArea').style.display = 'block';
        this.stopPracticeTimer();
        this.showQuestion();
    },

    // ===== 練習計時器 =====
    startPracticeTimer(seconds) {
        this.practiceTimeLeft = seconds;
        const el = document.getElementById('practiceTimer');
        if (el) el.style.display = 'inline-block';
        this.updatePracticeTimerDisplay();
        this.practiceTimerInterval = setInterval(() => {
            this.practiceTimeLeft--;
            this.updatePracticeTimerDisplay();
            if (this.practiceTimeLeft <= 0) {
                this.stopPracticeTimer();
                this.showPracticeComplete(true);
            }
        }, 1000);
    },

    updatePracticeTimerDisplay() {
        const el = document.getElementById('practiceTimer');
        if (!el) return;
        const m = Math.floor(this.practiceTimeLeft / 60);
        const s = this.practiceTimeLeft % 60;
        el.textContent = `⏱ ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        el.className = 'practice-timer' + (this.practiceTimeLeft <= 120 ? ' timer-urgent' : '');
    },

    stopPracticeTimer() {
        if (this.practiceTimerInterval) {
            clearInterval(this.practiceTimerInterval);
            this.practiceTimerInterval = null;
        }
        const el = document.getElementById('practiceTimer');
        if (el) el.style.display = 'none';
    },

    // ===== 練習完成統計頁 =====
    showPracticeComplete(timeout = false) {
        this.stopPracticeTimer();
        const elapsed = this.practiceStartTime ? Math.floor((Date.now() - this.practiceStartTime) / 1000) : 0;
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        const total = this.practiceAttempted;
        const correct = this.practiceCorrect;
        const rate = total > 0 ? Math.round(correct / total * 100) : 0;

        document.getElementById('practiceArea').style.display = 'none';
        document.getElementById('practiceComplete').style.display = 'block';
        document.getElementById('completeTitle').textContent = timeout ? '⏰ 時間到！' : '🎉 練習完成！';
        document.getElementById('completeTotal').textContent = total || this.practiceQuestions.length;
        document.getElementById('completeCorrect').textContent = correct;
        document.getElementById('completePercent').textContent = total > 0 ? rate + '%' : '—';
        const timeBox = document.getElementById('completeTimeBox');
        if (timeBox) {
            timeBox.style.display = 'block';
            document.getElementById('completeTime').textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }
        this.updateDashboard();
    },

    // ===== 考試標記旗標 =====
    toggleExamFlag() {
        const idx = this.examCurrentIndex;
        if (!this.examFlagged) this.examFlagged = new Set();
        if (this.examFlagged.has(idx)) {
            this.examFlagged.delete(idx);
        } else {
            this.examFlagged.add(idx);
        }
        this.updateExamFlagBtn();
        this.renderExamNavDots();
    },

    updateExamFlagBtn() {
        const btn = document.getElementById('examFlagBtn');
        if (!btn) return;
        const flagged = this.examFlagged && this.examFlagged.has(this.examCurrentIndex);
        btn.textContent = flagged ? '🚩 已標記' : '🚩';
        btn.className = 'btn btn-flag' + (flagged ? ' flagged' : '');
    },

    // ===== 考試詳解 =====
    toggleExamReview() {
        const reviewEl = document.getElementById('examReview');
        if (!reviewEl) return;
        const isHidden = reviewEl.style.display === 'none';
        if (isHidden) {
            this.renderExamReview();
            reviewEl.style.display = 'block';
        } else {
            reviewEl.style.display = 'none';
        }
    },

    renderExamReview() {
        const container = document.getElementById('examReviewList');
        if (!container) return;
        const history = Storage.getExamHistory();
        if (!history.length) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">無記錄</p>';
            return;
        }
        const last = history[history.length - 1];
        if (!last.details || !last.details.length) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">此次考試無詳細記錄</p>';
            return;
        }
        let html = '';
        last.details.forEach((d, i) => {
            const cls = d.isCorrect ? 'review-correct' : 'review-wrong';
            const icon = d.isCorrect ? '✅' : '❌';
            html += `
                <div class="exam-review-item ${cls}">
                    <div class="review-header">${icon} 第 ${i + 1} 題
                        <span class="review-cat-badge">${this.sanitize(d.category)}</span>
                    </div>
                    <div class="review-q-text">${this.sanitize(d.question)}</div>
                    ${!d.isCorrect ? `
                        <div class="review-answers">
                            <div class="review-user-ans">你的答案：${this.sanitize(d.userAnswer)}</div>
                            <div class="review-correct-ans">正確答案：${this.sanitize(d.correctAnswer)}</div>
                        </div>` : ''}
                    ${d.explanation ? `<div class="review-explanation">💡 ${this.sanitize(d.explanation)}</div>` : ''}
                </div>`;
        });
        container.innerHTML = html;
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => App.init());
