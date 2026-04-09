// LocalStorage 管理模組（含錯誤處理）
const Storage = {
    KEYS: {
        PRACTICED: 'iaq_practiced',
        CORRECT: 'iaq_correct',
        WRONG: 'iaq_wrong',
        FAVORITES: 'iaq_favorites',
        UNCERTAIN: 'iaq_uncertain',
        EXAM_HISTORY: 'iaq_exam_history',
        QUESTION_STATS: 'iaq_question_stats',
        EXAM_DRAFT: 'iaq_exam_draft'
    },

    // 安全寫入 localStorage（處理配額滿的情況）
    setData(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_FILE_CORRUPTED') {
                console.warn('localStorage 配額已滿，嘗試清除舊資料...');
                this.cleanupOldData();
                try {
                    localStorage.setItem(key, JSON.stringify(data));
                    return true;
                } catch (e2) {
                    console.error('無法儲存資料到 localStorage:', e2);
                    alert('儲存空間已滿，請嘗試清除瀏覽器快取或刪除部分資料。');
                    return false;
                }
            }
            console.error('localStorage 寫入錯誤:', e);
            return false;
        }
    },

    // 安全讀取 localStorage
    getData(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('localStorage 讀取錯誤:', e);
            return null;
        }
    },

    // 清理舊資料（配額滿時）
    cleanupOldData() {
        // 刪除最舊的考試記錄
        const history = this.getData(this.KEYS.EXAM_HISTORY) || [];
        if (history.length > 3) {
            history.pop();
            localStorage.setItem(this.KEYS.EXAM_HISTORY, JSON.stringify(history));
        }
    },

    // 匯出所有資料（備份）
    exportData() {
        const data = {};
        Object.values(this.KEYS).forEach(key => {
            const value = this.getData(key);
            if (value !== null) {
                data[key] = value;
            }
        });
        return JSON.stringify(data, null, 2);
    },

    // 匯入資料（還原）
    importData(jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            let imported = 0;
            Object.keys(data).forEach(key => {
                if (this.setData(key, data[key])) {
                    imported++;
                }
            });
            return { success: true, count: imported };
        } catch (e) {
            console.error('匯入資料失敗:', e);
            return { success: false, error: e.message };
        }
    },

    // 清除所有資料
    clearAllData() {
        Object.values(this.KEYS).forEach(key => {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.error('清除資料失敗:', e);
            }
        });
    },

    // 取得已練習題目ID列表
    getPracticed() {
        const data = this.getData(this.KEYS.PRACTICED);
        return data || [];
    },

    // 標記題目已練習
    markPracticed(questionId) {
        const practiced = this.getPracticed();
        if (!practiced.includes(questionId)) {
            practiced.push(questionId);
            this.setData(this.KEYS.PRACTICED, practiced);
        }
    },

    // 取得答題統計
    getStats() {
        const data = this.getData(this.KEYS.QUESTION_STATS);
        return data || {};
    },

    // 更新題目統計
    updateQuestionStats(questionId, isCorrect) {
        const stats = this.getStats();
        if (!stats[questionId]) {
            stats[questionId] = { correct: 0, wrong: 0, uncertain: 0 };
        }
        if (isCorrect) {
            stats[questionId].correct++;
        } else {
            stats[questionId].wrong++;
        }
        this.setData(this.KEYS.QUESTION_STATS, stats);
    },

    // 取得錯題列表
    getWrongQuestions() {
        return this.getData(this.KEYS.WRONG) || [];
    },

    // 新增錯題
    addWrongQuestion(question) {
        const wrongList = this.getWrongQuestions();
        const exists = wrongList.some(q => q.id === question.id);
        if (!exists) {
            wrongList.push({
                ...question,
                date: new Date().toISOString()
            });
            this.setData(this.KEYS.WRONG, wrongList);
        }
    },

    // 移除錯題
    removeWrongQuestion(questionId) {
        const wrongList = this.getWrongQuestions();
        const filtered = wrongList.filter(q => q.id !== questionId);
        this.setData(this.KEYS.WRONG, filtered);
    },

    // 清除所有錯題
    clearWrongQuestions() {
        this.setData(this.KEYS.WRONG, []);
    },

    // 取得收藏列表
    getFavorites() {
        return this.getData(this.KEYS.FAVORITES) || [];
    },

    // 切換收藏
    toggleFavorite(question) {
        const favorites = this.getFavorites();
        const index = favorites.findIndex(q => q.id === question.id);
        let isFav = false;
        if (index >= 0) {
            favorites.splice(index, 1);
        } else {
            favorites.push(question);
            isFav = true;
        }
        this.setData(this.KEYS.FAVORITES, favorites);
        return isFav;
    },

    // 檢查是否收藏
    isFavorite(questionId) {
        return this.getFavorites().some(q => q.id === questionId);
    },

    // 取得不確定題目
    getUncertain() {
        return this.getData(this.KEYS.UNCERTAIN) || [];
    },

    // 切換不確定
    toggleUncertain(question) {
        const uncertain = this.getUncertain();
        const index = uncertain.findIndex(q => q.id === question.id);
        let isUncertain = false;
        if (index >= 0) {
            uncertain.splice(index, 1);
        } else {
            uncertain.push({ ...question, date: new Date().toISOString() });
            isUncertain = true;
        }
        this.setData(this.KEYS.UNCERTAIN, uncertain);
        return isUncertain;
    },

    // 檢查是否不確定
    isUncertain(questionId) {
        return this.getUncertain().some(q => q.id === questionId);
    },

    // 取得考試歷史
    getExamHistory() {
        return this.getData(this.KEYS.EXAM_HISTORY) || [];
    },

    // 新增考試記錄
    addExamRecord(record) {
        const history = this.getExamHistory();
        history.unshift(record);
        if (history.length > 10) history.pop();
        this.setData(this.KEYS.EXAM_HISTORY, history);
    },

    // 取得類別統計
    getCategoryStats() {
        const stats = this.getStats();
        const result = {};
        Object.keys(QUESTIONS).forEach(cat => {
            const catQuestions = QUESTIONS[cat];
            let practiced = 0;
            let correct = 0;
            catQuestions.forEach(q => {
                if (stats[q.id]) {
                    practiced++;
                    correct += stats[q.id].correct;
                }
            });
            result[cat] = {
                total: catQuestions.length,
                practiced: practiced,
                correct: correct
            };
        });
        return result;
    },

    // 取得整體統計
    getOverallStats() {
        const catStats = this.getCategoryStats();
        let total = 0, practiced = 0, correct = 0, wrong = 0;
        Object.values(catStats).forEach(s => {
            total += s.total;
            practiced += s.practiced;
            correct += s.correct;
            wrong += (s.practiced - s.correct);
        });
        return { total, practiced, correct, wrong };
    },

    // 儲存考試草稿（答案持久化）
    saveExamDraft(examData) {
        const draft = {
            examAnswers: this.getData(this.KEYS.EXAM_DRAFT)?.examAnswers || {},
            examQuestions: examData.examQuestions,
            examCurrentIndex: examData.examCurrentIndex,
            examStartTime: examData.examStartTime,
            savedAt: new Date().toISOString()
        };
        this.setData(this.KEYS.EXAM_DRAFT, draft);
    },

    // 取得考試草稿
    getExamDraft() {
        return this.getData(this.KEYS.EXAM_DRAFT);
    },

    // 清除考試草稿
    clearExamDraft() {
        localStorage.removeItem(this.KEYS.EXAM_DRAFT);
    }
};