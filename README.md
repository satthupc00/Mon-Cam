# Mon Cam

App quay màn hình cho Windows (giống Bandicam), by Mondiro.

- Quay theo vùng kéo chọn, toàn màn hình hoặc 1 cửa sổ
- Xuất MP4 15/30/60 fps hoặc GIF
- Bật/tắt con trỏ chuột, hiệu ứng click, âm thanh máy (trong Cài đặt)
- Tạm dừng / tiếp tục khi đang quay
- Xem lại ngay: cắt thành nhiều đoạn, xoá đoạn (để lại khoảng trống = hình đen), kéo đoạn tự hít vào mép, lăn chuột phóng to timeline, chuột phải kéo để di chuyển; lưu MP4 hoặc xuất GIF
- Ghi chú lên video (mũi tên, khung, chữ, bút, tô sáng), in luôn khi lưu
- Chụp ảnh màn hình (PrtSc) kèm vẽ ghi chú, copy thẳng để dán
- Chạy ở khay hệ thống: tắt cửa sổ vẫn bấm PrtSc được
- Tự cập nhật qua GitHub Releases

## Cài đặt
Vào mục **Releases** của repo, tải `MonCam-Setup-x.y.z.exe` và chạy.

## Phím tắt
| Phím | Việc |
|---|---|
| Ctrl+PrtSc | Chọn vùng & quay · đang quay bấm lại để dừng & lưu |
| PrtSc (hoặc Ctrl+Shift+S) | Chụp ảnh: A mũi tên · R khung · T chữ · P bút · H tô sáng · B làm mờ · 1 2 3 độ dày nét · Ctrl+Z hoàn tác · Enter/Ctrl+C copy · Ctrl+S lưu + copy |
| Space · S · Del · Ctrl+Z · ← → | Trong màn Xem lại: phát/dừng, cắt tại vạch đỏ, xoá đoạn, hoàn tác, lùi/tới từng khung |
| A · R · T · P · H · 1 2 3 | Trong màn Xem lại: chọn công cụ ghi chú (mũi tên, khung, chữ, bút, tô sáng), độ dày nét |

## Phát hành bản mới
Tăng `version` trong `package.json` và cập nhật `src/whatsnew.json`, rồi push. GitHub Actions sẽ tự build và tạo Release.
