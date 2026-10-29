# Mon Cam

App quay màn hình cho Windows (giống Bandicam), by Mondiro.

- Quay theo vùng kéo chọn, toàn màn hình hoặc 1 cửa sổ
- Xuất MP4 15/30/60 fps hoặc GIF
- Bật/tắt con trỏ chuột, hiệu ứng click, âm thanh máy (trong Cài đặt)
- Tạm dừng / tiếp tục khi đang quay
- Xem lại ngay: cắt thành nhiều đoạn, xoá đoạn (để lại khoảng trống = hình đen), kéo đoạn tự hít vào mép, lăn chuột phóng to timeline, chuột phải kéo để di chuyển; lưu MP4 hoặc xuất GIF
- Chụp ảnh màn hình (PrtSc) kèm vẽ ghi chú, copy thẳng để dán
- Chạy ở khay hệ thống: tắt cửa sổ vẫn bấm PrtSc / F12 được
- Tự cập nhật qua GitHub Releases

## Cài đặt
Vào mục **Releases** của repo, tải `MonCam-Setup-x.y.z.exe` và chạy.

## Phím tắt
| Phím | Việc |
|---|---|
| F12 | Chọn vùng & quay (vùng cũ hiện sẵn) · đang quay thì dừng & lưu |
| Esc | Dừng & lưu khi đang quay |
| Shift+F12 | Tạm dừng / Tiếp tục |
| PrtSc (hoặc Ctrl+Shift+S) | Chụp ảnh: A mũi tên · R khung · T chữ · P bút · H tô sáng · B làm mờ · Ctrl+Z hoàn tác · Enter/Ctrl+C copy · Ctrl+S lưu + copy |
| Space · S · Del · Ctrl+Z · ← → | Trong màn Xem lại: phát/dừng, cắt tại vạch đỏ, xoá đoạn, hoàn tác, lùi/tới từng khung |

## Phát hành bản mới
Tăng `version` trong `package.json` và cập nhật `src/whatsnew.json`, rồi push. GitHub Actions sẽ tự build và tạo Release.
