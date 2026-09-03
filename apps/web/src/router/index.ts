import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomePage from '../pages/HomePage.vue'
import LevelCheckPage from '../pages/LevelCheckPage.vue'
import ReviewPage from '../pages/ReviewPage.vue'
import MapPage from '../pages/MapPage.vue'
import CollectionPage from '../pages/CollectionPage.vue'
import GuardianPage from '../pages/GuardianPage.vue'
import CreditsPage from '../pages/CreditsPage.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomePage, meta: { title: 'ホーム', nav: true } },
  { path: '/level-check', name: 'level-check', component: LevelCheckPage, meta: { title: 'レベルチェック', nav: true } },
  { path: '/review', name: 'review', component: ReviewPage, meta: { title: '今日の復習', nav: true } },
  { path: '/map', name: 'map', component: MapPage, meta: { title: '冒険マップ', nav: true } },
  { path: '/collection', name: 'collection', component: CollectionPage, meta: { title: '冒険バッグ', nav: true } },
  { path: '/guardian', name: 'guardian', component: GuardianPage, meta: { title: '保護者', nav: false } },
  { path: '/credits', name: 'credits', component: CreditsPage, meta: { title: '出典と権利表示', nav: false } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
