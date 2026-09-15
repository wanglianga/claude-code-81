import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import * as ElIcons from '@element-plus/icons-vue';
import App from './App.vue';
import router from './router';
import './styles.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus, { locale: zhCn });
for (const [k, v] of Object.entries(ElIcons)) app.component(k, v as any);
app.mount('#app');
